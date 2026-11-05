let songs = [];
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

async function syncSongsFromServer() {

    if (!db) return;

    try {

        console.log("Checking server for new songs...");

        const response = await fetch(API_URL);

        if (!response.ok) {
            throw new Error("Could not connect to Django server");
        }

        const serverSongs = await response.json();

        // Get songs previously deleted from mobile
        const deletedTransaction = db.transaction("deletedSongs", "readonly");
        const deletedRequest = deletedTransaction.objectStore("deletedSongs").getAll();

        const deletedSongs = await new Promise((resolve, reject) => {
            deletedRequest.onsuccess = () => resolve(deletedRequest.result);
            deletedRequest.onerror = () => reject(deletedRequest.error);
        });

        const deletedIds = deletedSongs.map(song => song.server_id);

        for (const serverSong of serverSongs) {

            // Don't download songs deleted by the mobile user
            if (deletedIds.includes(serverSong.id)) continue;

            const transaction = db.transaction("songs", "readonly");
            const store = transaction.objectStore("songs");

            const allSongs = await new Promise((resolve, reject) => {

                const request = store.getAll();

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);

            });

            const alreadyExists = allSongs.some(song =>
                song.server_id === serverSong.id
            );

            if (alreadyExists) continue;

            const audioResponse = await fetch(serverSong.audio_file);

            if (!audioResponse.ok) continue;

            const audioBlob = await audioResponse.blob();

            const newSong = {

                id: "server_" + serverSong.id,
                server_id: serverSong.id,

                title: serverSong.title,
                artist: serverSong.artist,
                album: serverSong.album,

                pic: "",
                file: audioBlob

            };

            await new Promise((resolve, reject) => {

                const saveTransaction = db.transaction("songs", "readwrite");

                saveTransaction.objectStore("songs").put(newSong);

                saveTransaction.oncomplete = resolve;
                saveTransaction.onerror = () => reject(saveTransaction.error);

            });

            console.log("Downloaded:", newSong.title);

        }

        loadSongs();

        console.log("Song sync completed!");

    } catch (error) {

        console.error("Sync error:", error);

    }

}

function renderimages(songArray = songs) {
    if (songcount) {
        songcount.textContent = `${songArray.length} song${songArray.length !== 1 ? 's' : ''}`;
    }

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
        const isCurrentlyPlaying = (currentIndex === actualIndex && !audio.paused);

        let div = document.createElement("div");
        div.className = `song-item ${currentIndex === actualIndex ? "playing" : ""}`;
        div.onclick = function (e) {
            if (!e.target.closest('.action-icon-btn')) {
                playsong(this, actualIndex);
            }
        };

        div.innerHTML = `
            <div class="song-left">
                <div class="cover-wrapper">
                    ${song.pic ? `<img src="${song.pic}" alt="Cover">` : `<div class="cover-placeholder"><i class="fa-solid fa-music"></i></div>`}
                    <div class="cover-play-badge">
                        <i class="play-btn fa-solid ${isCurrentlyPlaying ? 'fa-circle-pause' : 'fa-circle-play'}"></i>
                    </div>
                </div>
                <div class="song-details">
                    <h3 class="title">${song.title || "Unknown Song"}</h3>
                    <p class="artist-album">${song.artist || "Unknown Artist"}${song.album ? ' • ' + song.album : ''}</p>
                </div>
            </div>
            <div class="song-actions">
                <button class="action-icon-btn" onclick="event.stopPropagation(); del(this, ${actualIndex})" title="Delete">
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

    // Delete from mobile IndexedDB
    transaction.objectStore("songs").delete(songToDelete.id);

    // Remember deleted server song
    if (songToDelete.server_id !== undefined &&
        songToDelete.server_id !== null) {

        transaction.objectStore("deletedSongs").put({
            server_id: songToDelete.server_id
        });
    }

    transaction.oncomplete = () => {

        if (currentIndex === index) {
            audio.pause();
            currentIndex = -1;

            document.getElementById("player-name").textContent = "Select a song";
            document.getElementById("player-album").textContent = "Music Player";

            if (playerimg) playerimg.style.display = "none";
            if (playerimgplaceholder) playerimgplaceholder.style.display = "flex";

        } else if (currentIndex > index) {
            currentIndex--;
        }

        songs.splice(index, 1);

        renderimages();
        updateButtons();
    };

    transaction.onerror = () => {
        console.error("Delete failed:", transaction.error);
    };
};

const audio = new Audio();
let currentIndex = -1;
let currentURL = null;
let isRepeat = false;
let isShuffle = false;

window.playsong = function (element, index) {
    if (currentIndex !== index) {
        playSong(index);
    } else {
        togglePlay();
    }
};

function updateButtons() {
    document.querySelectorAll(".song-item").forEach((item, index) => {
        const isCurrent = (index === currentIndex);
        const playBtnIcon = item.querySelector(".cover-play-badge i");

        if (isCurrent && !audio.paused) {
            item.classList.add("playing");
            if (playBtnIcon) {
                playBtnIcon.className = "play-btn fa-solid fa-circle-pause";
            }
        } else {
            item.classList.remove("playing");
            if (playBtnIcon) {
                playBtnIcon.className = "play-btn fa-solid fa-circle-play";
            }
        }
    });

    if (playerplay) {
        if (audio.paused) {
            playerplay.className = "player-play fa-solid fa-circle-play";
        } else {
            playerplay.className = "player-play fa-solid fa-circle-pause";
        }
    }
}

function playSong(index) {
    if (index < 0 || index >= songs.length) return;

    if (currentURL) {
        URL.revokeObjectURL(currentURL);
    }

    if (songs[index].file) {
        currentURL = URL.createObjectURL(songs[index].file);
        audio.src = currentURL;
    }

    currentIndex = index;

    audio.play().then(() => {
        updateButtons();
    }).catch(console.error);

    if (songs[index].pic) {
        if (playerimg) {
            playerimg.style.display = "block";
            playerimg.src = songs[index].pic;
        }
        if (playerimgplaceholder) playerimgplaceholder.style.display = "none";
    } else {
        if (playerimg) playerimg.style.display = "none";
        if (playerimgplaceholder) playerimgplaceholder.style.display = "flex";
    }

    const titleElem = document.getElementById("player-name");
    const albumElem = document.getElementById("player-album");

    if (titleElem) titleElem.textContent = songs[index].title || "Unknown Song";
    if (albumElem) albumElem.textContent = (songs[index].artist || "Unknown Artist") + (songs[index].album ? ` • ${songs[index].album}` : "");

    updateButtons();
}

function togglePlay() {
    if (currentIndex === -1 && songs.length > 0) {
        playSong(0);
        return;
    }

    if (audio.paused) {
        audio.play();
    } else {
        audio.pause();
    }
    updateButtons();
}

if (progressbar) {
    progressbar.addEventListener("input", function () {
        const value = this.value;
        if (audio.duration) {
            audio.currentTime = (value / 100) * audio.duration;
        }
        progressbar.style.background = `linear-gradient(to right, #1db954 ${value}%, #33333e ${value}%)`;
    });
}

function updateProgress() {
    if (!audio.paused && audio.duration) {
        const value = (audio.currentTime / audio.duration) * 100;
        if (progressbar) {
            progressbar.value = value;
            progressbar.style.background = `linear-gradient(to right, #1db954 ${value}%, #33333e ${value}%)`;
        }
        const stampLeft = document.getElementById("stamp-left");
        if (stampLeft) stampLeft.textContent = formatTime(audio.currentTime);
    }
    requestAnimationFrame(updateProgress);
}

updateProgress();

if (input) {
    input.addEventListener("change", () => {
        const jsTagReader = window.jsmediatags || (typeof jsmediatags !== "undefined" ? jsmediatags : null);

        for (let i = 0; i < input.files.length; i++) {
            const file = input.files[i];

            const handleSongAdd = (title, artist, album, image) => {
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
                    file: file
                };

                saveSong(s);
                songs.unshift(s);
                renderimages();
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
                            image = `data:${picture.format};base64,${btoa(base64)}`;
                        }
                        function clean(text) {
                            return (text || "")
                                .replace(/\s*-\s*MassTamilan(\.[a-z]+)?/i, "")
                                .trim();
                        }
                        const title = clean(tag.tags.title);
                        const artist = clean(tag.tags.artist);
                        const album = clean(tag.tags.album);

                        handleSongAdd(title, artist, album, image);
                    },
                    onError: function () {
                        handleSongAdd("", "", "", "");
                    }
                });
            } else {
                handleSongAdd("", "", "", "");
            }
        }
    });
}

function loadSongs() {
    if (!db) return;
    const transaction = db.transaction("songs", "readonly");
    const store = transaction.objectStore("songs");
    const req = store.getAll();

    req.onsuccess = () => {
        songs = req.result;
        renderimages();
        updateButtons();
    };
}

audio.addEventListener("loadedmetadata", () => {
    const stampRight = document.getElementById("stamp-right");
    const stampLeft = document.getElementById("stamp-left");

    if (stampRight) stampRight.textContent = formatTime(audio.duration);
    if (stampLeft) stampLeft.textContent = formatTime(audio.currentTime);
});

function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

if (playerplay) {
    playerplay.addEventListener("click", () => {
        togglePlay();
    });
}

const nextBtn = document.querySelector(".next");
if (nextBtn) {
    nextBtn.addEventListener("click", () => {
        if (songs.length === 0) return;
        if (isShuffle) {
            let nextIndex = Math.floor(Math.random() * songs.length);
            playSong(nextIndex);
        } else {
            playSong((currentIndex + 1) % songs.length);
        }
    });
}

const prevBtn = document.querySelector(".previous");
if (prevBtn) {
    prevBtn.addEventListener("click", () => {
        if (songs.length === 0) return;
        let prevIndex = currentIndex - 1;
        if (prevIndex < 0) prevIndex = songs.length - 1;
        playSong(prevIndex);
    });
}

if (repeatbtn) {
    repeatbtn.addEventListener("click", () => {
        isRepeat = !isRepeat;
        repeatbtn.classList.toggle("active", isRepeat);
    });
}

if (shufflebtn) {
    shufflebtn.addEventListener("click", () => {
        isShuffle = !isShuffle;
        shufflebtn.classList.toggle("active", isShuffle);
    });
}

audio.addEventListener("ended", () => {
    if (progressbar) {
        progressbar.value = 0;
        progressbar.style.background = "linear-gradient(to right, #1db954 0%, #33333e 0%)";
    }

    const stampLeft = document.getElementById("stamp-left");
    if (stampLeft) stampLeft.textContent = "0:00";

    if (isRepeat) {
        audio.currentTime = 0;
        audio.play();
        return;
    }

    if (isShuffle) {
        let shuffle = Math.floor(Math.random() * songs.length);
        playSong(shuffle);
        return;
    }

    if (currentIndex < songs.length - 1) {
        playSong(currentIndex + 1);
    } else {
        updateButtons();
    }
});

if (songsearch) {
    songsearch.addEventListener("input", function () {
        const searchText = this.value.trim().toLowerCase();

        if (searchText === "") {
            renderimages();
            updateButtons();
            return;
        }

        const filteredSongs = songs.filter(song =>
            (song.title || "").toLowerCase().includes(searchText) ||
            (song.artist || "").toLowerCase().includes(searchText) ||
            (song.album || "").toLowerCase().includes(searchText)
        );

        renderimages(filteredSongs);
    });
}

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js")
        .then(() => console.log("Service Worker Registered"))
        .catch(() => { });
}

// Check for new songs every 30 seconds
setInterval(() => {

    if (navigator.onLine) {
        syncSongsFromServer();
    }

}, 30000);

// Check again when internet returns
window.addEventListener("online", () => {
    syncSongsFromServer();
});