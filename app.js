

//AQ.Ab8RN6I9sJCa-2HKDmrMhTz8fVTTFqrIUAzbqgbxhFSYNJe0Jg
// ==========================================
// KONFIGURASI GLOBAL & API KEYS
// ==========================================
const GEMINI_API_KEY = "AQ.Ab8RN6I9sJCa-2HKDmrMhTz8fVTTFqrIUAzbqgbxhFSYNJe0Jg"; // Masukkan API Key aktif

// State Penyimpanan Telemetri Terakhir untuk AI Analysis
let latestTelemetry = {
    r1: { voltage: 0, current: 0, power: 0, energy: 0 },
    r2: { voltage: 0, current: 0, power: 0, energy: 0 },
    waterLevel: 0
};

// State Status Relay
let relayStates = { 1: false, 2: false, 3: false, 4: false, 5: false };

let mqttClient = null;

// ==========================================
// 1. KONEKSI & LOGIKA MQTT (WSS Port 8084)
// ==========================================
function initMQTT() {
    const clientID = "WebDashboard_" + Math.random().toString(36).substring(2, 10);
    
    // Gunakan port WSS 8084 dan path /mqtt untuk GitHub Pages (HTTPS)
    mqttClient = new Paho.MQTT.Client("broker.emqx.io", 8084, "/mqtt", clientID);

    mqttClient.onConnectionLost = function(res) {
        console.warn("[MQTT] Terputus:", res.errorMessage);
        updateStatusUI(false);
        // Reconnect otomatis setelah 5 detik
        setTimeout(initMQTT, 5000);
    };

    mqttClient.onMessageArrived = function(message) {
        try {
            const payload = JSON.parse(message.payloadString);
            console.log("[MQTT Data Masuk]:", payload);
            updateDashboard(payload);
        } catch (e) { 
            console.error("[MQTT Parse Error]:", e); 
        }
    };

    const connectOptions = {
        useSSL: true, // Wajib true di HTTPS (GitHub Pages)
        timeout: 10,
        keepAliveInterval: 30,
        cleanSession: true,
        onSuccess: function() {
            console.log("[MQTT] Berhasil Terhubung via WSS (8084)!");
            updateStatusUI(true);
            mqttClient.subscribe("smartbuilding/telemetry");
        },
        onFailure: function(err) {
            console.error("[MQTT Gagal Konek]:", err);
            updateStatusUI(false);
            setTimeout(initMQTT, 5000);
        }
    };

    mqttClient.connect(connectOptions);
}

function updateStatusUI(isConnected) {
    const statusEl = document.getElementById('mqttStatus');
    if (!statusEl) return;
    
    if (isConnected) {
        statusEl.className = "flex items-center gap-2 text-xs text-emerald-400 font-semibold bg-emerald-950/40 border border-emerald-800/50 px-3 py-1.5 rounded-full";
        statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Terhubung`;
    } else {
        statusEl.className = "flex items-center gap-2 text-xs text-red-400 font-semibold bg-red-950/40 border border-red-800/50 px-3 py-1.5 rounded-full";
        statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span> Terputus`;
    }
}

// Update Elemen Dashboard UI dari Payload Telemetri
function updateDashboard(data) {
    // Ruang 1 (PZEM 1)
    if (data.r1) {
        latestTelemetry.r1 = data.r1;
        document.getElementById('r1_voltage').innerText = data.r1.voltage ?? 0;
        document.getElementById('r1_current').innerText = data.r1.current ?? 0;
        document.getElementById('r1_power').innerText = data.r1.power ?? 0;
        document.getElementById('r1_energy').innerText = data.r1.energy ?? 0;
    }

    // Ruang 2 (PZEM 2)
    if (data.r2) {
        latestTelemetry.r2 = data.r2;
        document.getElementById('r2_voltage').innerText = data.r2.voltage ?? 0;
        document.getElementById('r2_current').innerText = data.r2.current ?? 0;
        document.getElementById('r2_power').innerText = data.r2.power ?? 0;
        document.getElementById('r2_energy').innerText = data.r2.energy ?? 0;
    }

    // Tangki Air
    if (data.waterLevel !== undefined) {
        latestTelemetry.waterLevel = data.waterLevel;
        document.getElementById('water_level').innerText = data.waterLevel;
        
        const pumpBadge = document.getElementById('pump_badge');
        if (data.waterLevel >= 10) {
            pumpBadge.className = "text-xs px-3 py-1 rounded-full font-medium bg-emerald-950 text-emerald-400 border border-emerald-800";
            pumpBadge.innerText = "Pompa: AK TIF (Mengisi)";
        } else if (data.waterLevel <= 6) {
            pumpBadge.className = "text-xs px-3 py-1 rounded-full font-medium bg-slate-800 text-slate-400 border border-slate-700";
            pumpBadge.innerText = "Pompa: OFF (Penuh)";
        }
    }
}

// Fungsi Mengirim Perintah Relay ke ESP32
function toggleRelay(relayNumber) {
    if (!mqttClient || !mqttClient.isConnected()) {
        alert("MQTT belum terhubung. Periksa koneksi broker.");
        return;
    }

    relayStates[relayNumber] = !relayStates[relayNumber];
    const stateStr = relayStates[relayNumber] ? "ON" : "OFF";
    
    // Publish perintah ke topik kontrol relay
    const message = new Paho.MQTT.Message(JSON.stringify({ relay: relayNumber, state: stateStr }));
    message.destinationName = "smartbuilding/control";
    mqttClient.send(message);

    // Update Tampilan Tombol
    const btn = document.getElementById(`relay${relayNumber}_btn`);
    const statusText = document.getElementById(`relay${relayNumber}_status`);
    
    if (relayStates[relayNumber]) {
        btn.classList.add('relay-active');
        statusText.innerText = "ON";
    } else {
        btn.classList.remove('relay-active');
        statusText.innerText = "OFF";
    }
}

// ==========================================
// 2. INTEGRASI GEMINI AI API (gemini-2.5-flash)
// ==========================================
async function analyzeEnergyWithAI() {
    const outputEl = document.getElementById('ai_output');
    outputEl.innerHTML = `<span class="text-indigo-400 animate-pulse">⏳ Menghubungkan ke Gemini AI untuk menganalisis data...</span>`;

    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("GANTI_DENGAN")) {
        outputEl.innerHTML = `<span class="text-red-400">Error: Kunci API Gemini belum diisi dengan benar di file app.js.</span>`;
        return;
    }

    const promptText = `
    Anda adalah konsultan energi pintar IoT untuk gedung SMKN 4 Bandung.
    Analisis data telemetri berikut dan berikan evaluasi singkat, efisiensi energi, serta saran tindakan (maksimal 3 paragraf singkat):

    - Ruang 1 (TAV-1): Tegangan ${latestTelemetry.r1.voltage}V, Arus ${latestTelemetry.r1.current}A, Daya ${latestTelemetry.r1.power}W, Total ${latestTelemetry.r1.energy}kWh.
    - Ruang 2 (TAV-2): Tegangan ${latestTelemetry.r2.voltage}V, Arus ${latestTelemetry.r2.current}A, Daya ${latestTelemetry.r2.power}W, Total ${latestTelemetry.r2.energy}kWh.
    - Level Air Tangki: ${latestTelemetry.waterLevel} cm.
    `;

    // Endpoint v1beta dengan model gemini-2.5-flash
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }]
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("[Gemini Error Response]:", data);
            outputEl.innerHTML = `<span class="text-red-400">Error API (${response.status}): ${data.error?.message || "Gagal mendapatkan respons AI."}</span>`;
            return;
        }

        const reply = data.candidates[0].content.parts[0].text;
        outputEl.innerText = reply;

    } catch (err) {
        console.error("[Gemini Fetch Error]:", err);
        outputEl.innerHTML = `<span class="text-red-400">Gagal terhubung ke layanan AI. Periksa koneksi internet Anda.</span>`;
    }
}

// Inisialisasi saat dokumen siap
document.addEventListener("DOMContentLoaded", function() {
    initMQTT();
});

    const aiReply = await fetchGeminiAPI(promptText);
    appendChatMessage("Analisis Otomatis AI", aiReply, false);
    btnEl.disabled = false;
}
