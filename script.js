
let songs = [];
let currentSongs = [];
let selectedComposer = "all";
let searchText = "";
let syncInProgress = false;
let shuffleHistory = [];
let shuffleLastSong = null;
const addbtn = document.querySelector(".addmusic");
const input = document.getElementById("mp3");
const songlist = document.querySelector(".song-list");
const progressbar = document.getElementById("progress-bar");
const playerplay = document.querySelector(".player-play");
const repeatbtn = document.querySelector(".repeat");
const shufflebtn = document.querySelector(".shuffle");
const playerimg = document.getElementById("player-img");
const playerimgplaceholder = document.getElementById("player-img-placeholder");
const songsearch = document.querySelector(".findsong");
const songcount = document.getElementById("song-count");

const SERVER_URL = "https://kettify-server.onrender.com";
const API_URL = `${SERVER_URL}/api/songs/`;

let db;

const request = indexedDB.open("MusicDB", 3);

request.onupgradeneeded = (e) => {

    db = e.target.result;

    if (!db.objectStoreNames.contains("songs")) {
        db.createObjectStore("songs", {
            keyPath: "id"
        });
    }

    if (!db.objectStoreNames.contains("deletedSongs")) {
        db.createObjectStore("deletedSongs", {
            keyPath: "server_id"
        });
    }

};

request.onsuccess = async (e) => {

    db = e.target.result;

    loadSongs();

    await syncSongsFromServer();

};

function saveSong(song) {

    if (!db) return;

    const transaction = db.transaction("songs", "readwrite");
    const store = transaction.objectStore("songs");

    store.put(song);
}


async function getCoverImage(coverUrl) {

    if (!coverUrl) return "";

    try {

        const response = await fetch(coverUrl);

        if (!response.ok) return "";

        const blob = await response.blob();

        return await new Promise((resolve) => {

            const reader = new FileReader();

            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve("");

            reader.readAsDataURL(blob);

        });

    } catch (error) {

        console.error("Cover download failed:", error);
        return "";

    }
}


async function syncSongsFromServer() {

    if (!db || syncInProgress) return;

    syncInProgress = true;

    try {

        console.log("Checking server for songs...");

        let nextUrl = API_URL;
        let serverSongs = [];

        while (nextUrl) {

            const response = await fetch(nextUrl, {
                cache: "no-store"
            });

            if (!response.ok) {
                throw new Error("Could not connect to Django server");
            }

            const data = await response.json();

            if (Array.isArray(data)) {

                serverSongs = data;
                nextUrl = null;

            } else {

                serverSongs.push(...(data.results || []));
                nextUrl = data.next;

            }

        }

        if (!Array.isArray(serverSongs)) {
            throw new Error("Invalid server song list");
        }

        console.log("Total songs received from server:", serverSongs.length);

        const transaction = db.transaction("songs", "readonly");
        const request = transaction.objectStore("songs").getAll();

        const mobileSongs = await new Promise((resolve, reject) => {

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);

        });

        const serverIds = new Set(
            serverSongs.map(song => Number(song.id))
        );

        const missingSongs = mobileSongs.filter(song =>
            song.server_id !== undefined &&
            song.server_id !== null &&
            !serverIds.has(Number(song.server_id))
        );

        if (missingSongs.length > 0) {

            const currentSong = currentIndex >= 0
                ? songs[currentIndex]
                : null;

            const currentSongDeleted = currentSong &&
                missingSongs.some(song => song.id === currentSong.id);

            await new Promise((resolve, reject) => {

                const deleteTransaction =
                    db.transaction("songs", "readwrite");

                const store =
                    deleteTransaction.objectStore("songs");

                missingSongs.forEach(song => {

                    store.delete(song.id);

                    console.log("Removed deleted cloud song:", song.title);

                });

                deleteTransaction.oncomplete = resolve;

                deleteTransaction.onerror = () =>
                    reject(deleteTransaction.error);

            });

            if (currentSongDeleted) {

                audio.pause();
                audio.removeAttribute("src");
                audio.load();

                if (currentURL) {
                    URL.revokeObjectURL(currentURL);
                    currentURL = null;
                }

                currentIndex = -1;

                const playerName = document.getElementById("player-name");
                const playerAlbum = document.getElementById("player-album");

                if (playerName) playerName.textContent = "Select a song";
                if (playerAlbum) playerAlbum.textContent = "Music Player";

                if (playerimg) playerimg.style.display = "none";

                if (playerimgplaceholder) {
                    playerimgplaceholder.style.display = "flex";
                }

            }

        }

        const remainingSongs = mobileSongs.filter(song =>
            !missingSongs.some(missing => missing.id === song.id)
        );

        const deletedTransaction =
            db.transaction("deletedSongs", "readonly");

        const deletedRequest =
            deletedTransaction.objectStore("deletedSongs").getAll();

        const deletedSongs = await new Promise((resolve, reject) => {

            deletedRequest.onsuccess = () =>
                resolve(deletedRequest.result);

            deletedRequest.onerror = () =>
                reject(deletedRequest.error);

        });

        const deletedIds = deletedSongs.map(song =>
            Number(song.server_id)
        );

        for (const serverSong of serverSongs) {

            if (deletedIds.includes(Number(serverSong.id))) {
                continue;
            }

            const existingSong = remainingSongs.find(song =>
                Number(song.server_id) === Number(serverSong.id)
            );

            if (existingSong) {

                const serverComposer =
                    serverSong.composer || "Unknown Composer";

                if (
                    (!existingSong.composer ||
                        existingSong.composer === "Unknown Composer") &&
                    serverComposer !== "Unknown Composer"
                ) {

                    existingSong.composer = serverComposer;

                    await new Promise((resolve, reject) => {

                        const updateTransaction =
                            db.transaction("songs", "readwrite");

                        updateTransaction
                            .objectStore("songs")
                            .put(existingSong);

                        updateTransaction.oncomplete = resolve;

                        updateTransaction.onerror = () =>
                            reject(updateTransaction.error);

                    });

                }

                continue;

            }

            const audioResponse = await fetch(serverSong.audio_file);

            if (!audioResponse.ok) continue;

            const audioBlob = await audioResponse.blob();

            const coverImage =
                await getCoverImage(serverSong.cover_image);

            const newSong = {

                id: "server_" + serverSong.id,
                server_id: serverSong.id,
                title: serverSong.title,
                artist: serverSong.artist,
                album: serverSong.album,
                composer: serverSong.composer || "Unknown Composer",
                pic: coverImage,
                file: audioBlob

            };

            await new Promise((resolve, reject) => {

                const saveTransaction =
                    db.transaction("songs", "readwrite");

                saveTransaction
                    .objectStore("songs")
                    .put(newSong);

                saveTransaction.oncomplete = resolve;

                saveTransaction.onerror = () =>
                    reject(saveTransaction.error);

            });

            remainingSongs.push(newSong);

            console.log("Downloaded:", newSong.title);

        }

        loadSongs();

        console.log("Song sync completed!");

    } catch (error) {

        console.error("Sync error:", error);

    } finally {

        syncInProgress = false;

    }

}


// AUDIO PLAYER

const audio = new Audio();

let currentIndex = -1;
let currentURL = null;

let isRepeat = false;
let isShuffle = false;


function renderimages(songArray = currentSongs) {

    if (searchText) {

        const query = searchText.toLowerCase();

        songArray = songArray.filter(song =>

            (song.title || "").toLowerCase().includes(query) ||
            (song.artist || "").toLowerCase().includes(query) ||
            (song.album || "").toLowerCase().includes(query)

        );

    }

    if (songcount) {

        songcount.textContent =
            `${songArray.length} song${songArray.length !== 1 ? 's' : ''}`;

    }

    if (!songlist) return;

    songlist.innerHTML = "";

    if (songArray.length === 0) {

        songlist.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-music"></i>
                <p>No songs found</p>
                <span>Tap the '+' button to add MP3 files</span>
            </div>
        `;

        updateButtons();

        return;

    }

    songArray.forEach((song) => {

        const actualIndex = songs.indexOf(song);

        const isCurrentlyPlaying =
            currentIndex === actualIndex && !audio.paused;

        let div = document.createElement("div");

        div.className =
            `song-item ${currentIndex === actualIndex ? "playing" : ""}`;

        div.dataset.songId = song.id;

        div.onclick = function (e) {

            if (!e.target.closest(".action-icon-btn")) {
                playSong(actualIndex);
            }
        
        };

        div.innerHTML = `

            <div class="song-left">

                <div class="cover-wrapper">

                    ${
                        song.pic
                            ? `<img src="${song.pic}" alt="Cover">`
                            : `<div class="cover-placeholder">
                                    <i class="fa-solid fa-music"></i>
                               </div>`
                    }

                    <div class="cover-play-badge">
                        <i class="play-btn fa-solid ${
                            isCurrentlyPlaying
                                ? "fa-circle-pause"
                                : "fa-circle-play"
                        }"></i>
                    </div>

                </div>

                <div class="song-details">

                    <h3 class="title">
                        ${song.title || "Unknown Song"}
                    </h3>

                    <p class="artist-album">
                        ${song.artist || "Unknown Artist"}${
                            song.album ? " • " + song.album : ""
                        }
                    </p>

                </div>

            </div>

            <div class="song-actions">

                <button
                    class="action-icon-btn"
                    onclick="event.stopPropagation(); del(this, ${actualIndex})"
                    title="Delete"
                >
                    <i class="fa-solid fa-trash-can"></i>
                </button>

            </div>

        `;

        songlist.appendChild(div);

    });

    updateButtons();

}


if (addbtn) {

    addbtn.addEventListener("click", () => {
        input.click();
    });

}


// DELETE SONG

window.del = function (element, index) {

    const songToDelete = songs[index];

    if (!songToDelete || !db) return;

    const card = element.closest(".song-item");

    if (card) {
        card.style.animation = "blast .3s linear forwards";
    }

    const transaction = db.transaction(
        ["songs", "deletedSongs"],
        "readwrite"
    );

    transaction.objectStore("songs").delete(songToDelete.id);

    if (
        songToDelete.server_id !== undefined &&
        songToDelete.server_id !== null
    ) {

        transaction.objectStore("deletedSongs").put({
            server_id: songToDelete.server_id
        });

    }

    transaction.oncomplete = () => {

        if (currentIndex === index) {

            audio.pause();
            audio.removeAttribute("src");
            audio.load();

            if (currentURL) {
                URL.revokeObjectURL(currentURL);
                currentURL = null;
            }

            currentIndex = -1;

            const playerName = document.getElementById("player-name");
            const playerAlbum = document.getElementById("player-album");

            if (playerName) playerName.textContent = "Select a song";
            if (playerAlbum) playerAlbum.textContent = "Music Player";

            if (playerimg) playerimg.style.display = "none";

            if (playerimgplaceholder) {
                playerimgplaceholder.style.display = "flex";
            }

        } else if (currentIndex > index) {

            currentIndex--;

        }

        songs.splice(index, 1);

        rendercomposer();
        applyComposerFilter();
        updateButtons();

    };

    transaction.onerror = () => {
        console.error("Delete failed:", transaction.error);
    };

};


// UPDATE PLAY BUTTONS

function updateButtons() {

    document.querySelectorAll(".song-item").forEach(item => {

        const isCurrent =
            String(item.dataset.songId) ===
            String(songs[currentIndex]?.id);

        const playBtnIcon =
            item.querySelector(".cover-play-badge i");

        if (isCurrent && !audio.paused) {

            item.classList.add("playing");

            if (playBtnIcon) {
                playBtnIcon.className =
                    "play-btn fa-solid fa-circle-pause";
            }

        } else {

            item.classList.remove("playing");

            if (playBtnIcon) {
                playBtnIcon.className =
                    "play-btn fa-solid fa-circle-play";
            }

        }

    });

    if (playerplay) {

        if (audio.paused) {

            playerplay.className =
                "player-play fa-solid fa-circle-play";

        } else {

            playerplay.className =
                "player-play fa-solid fa-circle-pause";

        }

    }

}


// PLAY SONG

// PLAY SONG

function playSong(index) {

    // Validate song index
    if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= songs.length
    ) {
        console.error("Invalid song index:", index);
        return;
    }

    const song = songs[index];

    // Check whether song and audio file exist
    if (!song || !song.file) {

        console.error("Song audio file not found:", song);

        return;
    }

    if (currentURL) {

        URL.revokeObjectURL(currentURL);
        currentURL = null;

    }

    currentURL = URL.createObjectURL(song.file);

    audio.src = currentURL;

    if (progressbar) {

        progressbar.value = 0;

        progressbar.style.background =
            "linear-gradient(to right, #1db954 0%, #33333e 0%)";

    }

    currentIndex = index;

    audio.play().then(() => {

        updateButtons();

    }).catch(console.error);

    if (song.pic) {

        if (playerimg) {

            playerimg.style.display = "block";
            playerimg.src = song.pic;

        }

        if (playerimgplaceholder) {
            playerimgplaceholder.style.display = "none";
        }

    } else {

        if (playerimg) {
            playerimg.style.display = "none";
        }

        if (playerimgplaceholder) {
            playerimgplaceholder.style.display = "flex";
        }

    }

    const titleElem = document.getElementById("player-name");
    const albumElem = document.getElementById("player-album");

    if (titleElem) {
        titleElem.textContent = song.title || "Unknown Song";
    }

    if (albumElem) {

        albumElem.textContent =
            (song.artist || "Unknown Artist") +
            (song.album ? ` • ${song.album}` : "");

    }

    updateButtons();

}


// PLAY / PAUSE

function togglePlay() {

    if (currentIndex === -1 && currentSongs.length > 0) {

        const firstIndex = songs.findIndex(
            song => song.id === currentSongs[0].id
        );

        if (firstIndex !== -1) {
            playSong(firstIndex);
        }

        return;

    }

    if (audio.paused) {

        audio.play();

    } else {

        audio.pause();

    }

    updateButtons();

}


// PROGRESS BAR

if (progressbar) {

    progressbar.addEventListener("input", function () {

        const value = this.value;

        if (audio.duration) {
            audio.currentTime = (value / 100) * audio.duration;
        }

        progressbar.style.background =
            `linear-gradient(to right, #1db954 ${value}%, #33333e ${value}%)`;

    });

}


function updateProgress() {

    if (!audio.paused && audio.duration) {

        const value =
            (audio.currentTime / audio.duration) * 100;

        if (progressbar) {

            progressbar.value = value;

            progressbar.style.background =
                `linear-gradient(to right, #1db954 ${value}%, #33333e ${value}%)`;

        }

        const stampLeft = document.getElementById("stamp-left");

        if (stampLeft) {
            stampLeft.textContent = formatTime(audio.currentTime);
        }

    }

    requestAnimationFrame(updateProgress);

}

updateProgress();


// ADD LOCAL MP3 SONGS

if (input) {

    input.addEventListener("change", () => {

        const jsTagReader =
            window.jsmediatags ||
            (typeof jsmediatags !== "undefined"
                ? jsmediatags
                : null);

        const selectedFiles = Array.from(input.files);

        for (let i = 0; i < selectedFiles.length; i++) {

            const file = selectedFiles[i];

            const handleSongAdd = (
                title,
                artist,
                album,
                image,
                composer
            ) => {

                const alreadyExists = songs.some(song =>

                    song.file &&
                    song.file.name === file.name &&
                    song.file.size === file.size &&
                    song.file.lastModified === file.lastModified

                );

                if (alreadyExists) return;

                let s = {

                    id: Date.now() + i,
                    pic: image,
                    title: title || file.name.replace(/\.[^/.]+$/, ""),
                    artist: artist || "Unknown Artist",
                    album: album || "Unknown Album",
                    composer: normalizeComposer(composer),
                    file: file

                };

                saveSong(s);

                if (currentIndex >= 0) {
                    currentIndex++;
                }

                songs.unshift(s);

                rendercomposer();
                applyComposerFilter();
                updateButtons();

            };


            if (jsTagReader) {

                jsTagReader.read(file, {

                    onSuccess: function (tag) {

                        let image = "";

                        if (tag.tags.picture) {

                            const picture = tag.tags.picture;

                            let base64 = "";

                            picture.data.forEach(byte => {
                                base64 += String.fromCharCode(byte);
                            });

                            image =
                                `data:${picture.format};base64,${btoa(base64)}`;

                        }

                        function clean(text) {

                            return (text || "")
                                .replace(
                                    /\s*-\s*MassTamilan(\.[a-z]+)?/i,
                                    ""
                                )
                                .trim();

                        }

                        const title = clean(tag.tags.title);
                        const artist = clean(tag.tags.artist);
                        const album = clean(tag.tags.album);

                        const composerTag =
                            tag.tags.TCOM?.data ||
                            tag.tags.composer?.data ||
                            tag.tags.composer ||
                            "";

                        const composer = clean(
                            Array.isArray(composerTag)
                                ? composerTag.join(", ")
                                : composerTag
                        );

                        handleSongAdd(
                            title,
                            artist,
                            album,
                            image,
                            composer
                        );

                    },

                    onError: function () {

                        handleSongAdd("", "", "", "", "");

                    }

                });

            } else {

                handleSongAdd("", "", "", "", "");

            }

        }

        input.value = "";

    });

}


// LOAD SONGS FROM INDEXEDDB

function loadSongs() {

    if (!db) return;

    const transaction = db.transaction("songs", "readonly");
    const store = transaction.objectStore("songs");
    const req = store.getAll();

    req.onsuccess = () => {

        const playingSongId =
            currentIndex >= 0
                ? songs[currentIndex]?.id
                : null;

        songs = req.result;

        if (playingSongId !== null) {

            currentIndex = songs.findIndex(
                song => song.id === playingSongId
            );

        }

        rendercomposer();
        applyComposerFilter();

        updateButtons();

    };

}


audio.addEventListener("play", updateButtons);
audio.addEventListener("pause", updateButtons);


audio.addEventListener("loadedmetadata", () => {

    const stampRight = document.getElementById("stamp-right");
    const stampLeft = document.getElementById("stamp-left");

    if (stampRight) {
        stampRight.textContent = formatTime(audio.duration);
    }

    if (stampLeft) {
        stampLeft.textContent = formatTime(audio.currentTime);
    }

});


function formatTime(seconds) {

    if (isNaN(seconds)) return "0:00";

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    return `${mins}:${secs.toString().padStart(2, "0")}`;

}


// PLAYER PLAY BUTTON

if (playerplay) {

    playerplay.addEventListener("click", () => {
        togglePlay();
    });

}


// NEXT SONG


function playNextSong() {

    if (currentSongs.length === 0) return;

    const currentSong = songs[currentIndex];

    let nextSong;

    if (isShuffle) {

        // Remove songs no longer in the current list
        shuffleHistory = shuffleHistory.filter(id =>
            currentSongs.some(song => song.id === id)
        );

        // Remember the currently playing song
        if (
            currentSong &&
            !shuffleHistory.includes(currentSong.id)
        ) {
            shuffleHistory.push(currentSong.id);
        }

        // Find songs not played in this shuffle cycle
        let remainingSongs = currentSongs.filter(song =>
            !shuffleHistory.includes(song.id)
        );

        // Start a new cycle after all songs have played
        if (remainingSongs.length === 0) {

            shuffleHistory = currentSong
                ? [currentSong.id]
                : [];

            remainingSongs = currentSongs.filter(song =>
                !shuffleHistory.includes(song.id)
            );

        }

        if (remainingSongs.length === 0) return;

        // Select a random unplayed song
        nextSong = remainingSongs[
            Math.floor(Math.random() * remainingSongs.length)
        ];

        shuffleHistory.push(nextSong.id);

    } else {

        const currentPosition = currentSongs.findIndex(
            song => song.id === currentSong?.id
        );

        const nextPosition =
            currentPosition === -1
                ? 0
                : (currentPosition + 1) % currentSongs.length;

        nextSong = currentSongs[nextPosition];

    }

    const actualIndex = songs.findIndex(
        song => song.id === nextSong.id
    );

    if (actualIndex !== -1) {
        playSong(actualIndex);
    }

}



// PREVIOUS SONG

function playPreviousSong() {

    if (currentSongs.length === 0) return;

    const currentSong = songs[currentIndex];

    const currentPosition = currentSongs.findIndex(
        song => song.id === currentSong?.id
    );

    const previousPosition =
        currentPosition <= 0
            ? currentSongs.length - 1
            : currentPosition - 1;

    const previousSong = currentSongs[previousPosition];

    const actualIndex = songs.findIndex(
        song => song.id === previousSong.id
    );

    if (actualIndex !== -1) {
        playSong(actualIndex);
    }

}


// NEXT BUTTON

const nextBtn = document.querySelector(".next");

if (nextBtn) {
    nextBtn.addEventListener("click", playNextSong);
}


// PREVIOUS BUTTON

const prevBtn = document.querySelector(".previous");

if (prevBtn) {
    prevBtn.addEventListener("click", playPreviousSong);
}


// REPEAT BUTTON

if (repeatbtn) {

    repeatbtn.addEventListener("click", () => {

        isRepeat = !isRepeat;

        repeatbtn.classList.toggle("active", isRepeat);

    });

}


// SHUFFLE BUTTON

if (shufflebtn) {

    shufflebtn.addEventListener("click", () => {

        isShuffle = !isShuffle;

        shufflebtn.classList.toggle("active", isShuffle);

    });

}


// AUTOMATIC NEXT SONG WHEN CURRENT SONG ENDS

audio.addEventListener("ended", () => {

    if (progressbar) {

        progressbar.value = 0;

        progressbar.style.background =
            "linear-gradient(to right, #1db954 0%, #33333e 0%)";

    }

    const stampLeft = document.getElementById("stamp-left");

    if (stampLeft) {
        stampLeft.textContent = "0:00";
    }

    if (isRepeat) {

        audio.currentTime = 0;

        audio.play().catch(console.error);

        return;

    }

    if (isShuffle) {

        playNextSong();

        return;

    }

    const currentSong = songs[currentIndex];

    const currentPosition = currentSongs.findIndex(
        song => song.id === currentSong?.id
    );

    if (
        currentPosition >= 0 &&
        currentPosition < currentSongs.length - 1
    ) {

        const nextSong = currentSongs[currentPosition + 1];

        const actualIndex = songs.findIndex(
            song => song.id === nextSong.id
        );

        if (actualIndex !== -1) {

            playSong(actualIndex);

            return;

        }

    }

    updateButtons();

});


// SEARCH SONGS

if (songsearch) {

    songsearch.addEventListener("input", function () {

        searchText = this.value.trim();

        renderimages(currentSongs);

    });

}


// SERVICE WORKER

if ("serviceWorker" in navigator) {

    navigator.serviceWorker.register("service-worker.js")

        .then(() => console.log("Service Worker Registered"))

        .catch(() => { });

}


// CHECK FOR NEW SONGS EVERY 30 SECONDS

setInterval(() => {

    if (navigator.onLine) {
        syncSongsFromServer();
    }

}, 30000);


// CHECK AGAIN WHEN INTERNET RETURNS

window.addEventListener("online", () => {

    syncSongsFromServer();

});


// NORMALIZE COMPOSER NAME

function normalizeComposer(value) {

    let composer = "";

    if (typeof value === "string") {

        composer = value.trim();

    } else if (value && typeof value === "object") {

        composer = String(
            value.text || value.data || ""
        ).trim();

    }

    if (
        composer ===
        "'''Songs:'''Premji Amaran'''Score:'''Sabesh–Murali"
    ) {

        composer = "Premgi Amaran";

    }

    return composer || "Unknown Composer";

}


// RENDER COMPOSER DROPDOWN


// function rendercomposer() {

//     const options = document.querySelector(".custom-options");
//     const selectWrapper = document.querySelector(".select-wrapper");
//     const selectedText = document.querySelector(".selected-composer");

//     if (!options) return;

//     // Clear only the options list
//     options.innerHTML = "";

//     const composers = [...new Set(
//         songs
//             .map(song => normalizeComposer(song.composer))
//             .filter(composer => composer !== "Unknown Composer")
//     )].sort((a, b) => a.localeCompare(b));

//     if (
//         selectedComposer !== "all" &&
//         !composers.includes(selectedComposer)
//     ) {
//         selectedComposer = "all";
//     }

//     // All Composers option
//     const all = document.createElement("li");

//     all.textContent = "All Composers";
//     all.dataset.composer = "all";

//     all.classList.toggle(
//         "selected",
//         selectedComposer === "all"
//     );

//     options.appendChild(all);

//     // Individual composers
//     composers.forEach(composer => {

//         const li = document.createElement("li");

//         li.textContent = composer;
//         li.dataset.composer = composer;

//         li.classList.toggle(
//             "selected",
//             selectedComposer === composer
//         );

//         options.appendChild(li);

//     });

//     // Update button text
//     if (selectedText) {
//         selectedText.textContent =
//             selectedComposer === "all"
//                 ? "All Composers"
//                 : selectedComposer;
//     }

//     // Close dropdown after rendering
//     if (selectWrapper) {
//         selectWrapper.classList.remove("open");
//     }
// }


// RENDER COMPOSER DROPDOWN

function rendercomposer() {

    const options = document.querySelector(".custom-options");
    const selectedText = document.querySelector(".selected-composer");

    if (!options) return;

    options.innerHTML = "";

    // Get unique composers
    const composers = [...new Set(
        songs
            .map(song => normalizeComposer(song.composer))
            .filter(composer => composer !== "Unknown Composer")
    )].sort((a, b) => a.localeCompare(b));

    // Remove composers that no longer exist
    selectedComposers = selectedComposers.filter(
        composer => composers.includes(composer)
    );

    // All Composers option
    const all = document.createElement("li");

    all.textContent = selectedComposers.length === 0
        ? "✓ All Composers"
        : "All Composers";

    all.dataset.composer = "all";

    if (selectedComposers.length === 0) {
        all.classList.add("selected");
    }

    options.appendChild(all);

    // Individual composers
    composers.forEach(composer => {

        const li = document.createElement("li");

        const isSelected = selectedComposers.includes(composer);

        li.textContent = (isSelected ? "✓ " : "　 ") + composer;

        li.dataset.composer = composer;

        if (isSelected) {
            li.classList.add("selected");
        }

        options.appendChild(li);

    });

    // Update dropdown button text
    if (selectedText) {

        if (selectedComposers.length === 0) {
            selectedText.textContent = "All Composers";
        }
        else if (selectedComposers.length === 1) {
            selectedText.textContent = selectedComposers[0];
        }
        else {
            selectedText.textContent =
                selectedComposers.length + " Composers Selected";
        }

    }
}

// DROPDOWN EVENTS

// DROPDOWN EVENTS

const selectWrapper = document.querySelector(".select-wrapper");
const composerSelect = document.querySelector(".composer-select");
const composerOptions = document.querySelector(".custom-options");

if (selectWrapper && composerSelect && composerOptions) {

    composerOptions.style.display = "none";

    // Open / close dropdown
    composerSelect.addEventListener("click", function(e) {

        e.stopPropagation();

        const isOpening =
            getComputedStyle(composerOptions).display === "none";

        composerOptions.style.display =
            isOpening ? "block" : "none";

        selectWrapper.classList.toggle("open", isOpening);

    });

    // Select multiple composers
    composerOptions.addEventListener("click", function(e) {

        const item = e.target.closest("li");

        if (!item || !composerOptions.contains(item)) return;

        const composer = item.dataset.composer;

        if (!composer) return;

        // All Composers
        if (composer === "all") {

            selectedComposers = [];

            rendercomposer();
            applyComposerFilter();

            composerOptions.style.display = "none";
            selectWrapper.classList.remove("open");

            return;
        }

        // Toggle individual composer
        if (selectedComposers.includes(composer)) {

            selectedComposers =
                selectedComposers.filter(c => c !== composer);

        } else {

            selectedComposers.push(composer);

        }

        rendercomposer();
        applyComposerFilter();

        // Keep dropdown open for more selections
    });

    // Close when clicking outside
    document.addEventListener("click", function(e) {

        if (!selectWrapper.contains(e.target)) {

            composerOptions.style.display = "none";

            selectWrapper.classList.remove("open");

        }

    });

}


// APPLY COMPOSER FILTER

function applyComposerFilter() {

    if (selectedComposers.length === 0) {

        currentSongs = [...songs];

    } else {

        currentSongs = songs.filter(song =>
            selectedComposers.includes(
                normalizeComposer(song.composer)
            )
        );

    }

    renderimages(currentSongs);
}
