/**
 * Aplikasi Dashboard IoT Monitoring & AI Consultant
 */

// ==========================================
// 1. KONFIGURASI KUNCI DAN TARIF
// ==========================================
const GEMINI_API_KEY = "AQ.Ab8RN6I9sJCa-2HKDmrMhTz8fVTTFqrIUAzbqgbxhFSYNJe0Jg"; // Ganti dengan Kunci API Gemini Anda

const TARIF_LISTRIK_PER_KWH = 1444.70; 
const TARIF_AIR_PER_DETIK = 37.5;      

// Accounts Database
const USERS = {
    'admin': { pass: 'admin123', role: 'admin', room: 'all' },
    'user1': { pass: 'user123', role: 'user', room: 1 },
    'user2': { pass: 'user123', role: 'user', room: 2 }
};

let currentUser = null;
let mqttClient = null;

// Application State
let stateData = {
    r1: { volts: 0, amps: 0, watts: 0, kwh: 0, lamp: false, socket: false, grossElecCost: 0, paidAmount: 0, baseKwhOffset: 0 },
    r2: { volts: 0, amps: 0, watts: 0, kwh: 0, lamp: false, socket: false, grossElecCost: 0, paidAmount: 0, baseKwhOffset: 0 },
    water: { distance: 0, pump: false, percent: 0, activeSeconds: 0, totalCost: 0 }
};

let pumpStartTime = null;

// ==========================================
// 2. LOGIKA AUTENTIKASI & PERMISSION
// ==========================================
function handleLogin(e) {
    e.preventDefault();
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value.trim();

    if (USERS[u] && USERS[u].pass === p) {
        currentUser = USERS[u];
        document.getElementById('loginSection').classList.add('hidden');
        document.getElementById('dashboardSection').classList.remove('hidden');
        document.getElementById('userBadge').innerText = `User: ${u.toUpperCase()} (${currentUser.role})`;
        
        applyRolePermissions();
        initMQTT();
    } else {
        alert('Username atau Password Salah!');
    }
}

function logout() { 
    location.reload(); 
}

function applyRolePermissions() {
    const cardR1 = document.getElementById('cardRoom1');
    const cardR2 = document.getElementById('cardRoom2');

    if (currentUser.role === 'admin') {
        cardR1.classList.remove('hidden');
        cardR2.classList.remove('hidden');
    } else if (currentUser.room === 1) {
        cardR1.classList.remove('hidden');
        cardR2.classList.add('hidden');
    } else if (currentUser.room === 2) {
        cardR1.classList.add('hidden');
        cardR2.classList.remove('hidden');
    }
}

// ==========================================
// 3. LOGIKA MQTT WEBSOCKETS
// ==========================================
function initMQTT() {
    const clientID = "Web_Dashboard_" + Math.random().toString(16).substr(2, 8);
    mqttClient = new Paho.MQTT.Client("broker.emqx.io", 8083, clientID);

    mqttClient.onConnectionLost = function(res) {
        console.warn("[MQTT] Connection Lost:", res.errorMessage);
        const statusEl = document.getElementById('mqttStatus');
        statusEl.className = "flex items-center gap-2 text-xs text-red-400 font-semibold bg-red-950/40 border border-red-800/50 px-3 py-1 rounded-full";
        statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span> Terputus`;
    };

    mqttClient.onMessageArrived = function(message) {
        try {
            const payload = JSON.parse(message.payloadString);
            console.log("[MQTT Payload Arrived]:", payload);
            updateDashboard(payload);
        } catch (e) { 
            console.error("[MQTT Error] Failed to parse JSON payload:", e); 
        }
    };

    mqttClient.connect({
        onSuccess: function() {
            console.log("[MQTT] Connected successfully to broker.emqx.io");
            const statusEl = document.getElementById('mqttStatus');
            statusEl.className = "flex items-center gap-2 text-xs text-emerald-400 font-semibold bg-emerald-950/40 border border-emerald-800/50 px-3 py-1 rounded-full";
            statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Terhubung`;
            mqttClient.subscribe("smartbuilding/telemetry");
        },
        useSSL: false
    });
}

function toggleRelaySlide(deviceName, el) {
    const payload = JSON.stringify({
        device: deviceName,
        state: el.checked
    });
    console.log(`[MQTT Publish Control] Device: ${deviceName}, State: ${el.checked}`);
    const message = new Paho.MQTT.Message(payload);
    message.destinationName = "smartbuilding/control";
    mqttClient.send(message);
}

// ==========================================
// 4. PEMBARUAN DASHBOARD & KALKULASI TAGIHAN
// ==========================================
function updateDashboard(data) {
    // Ruangan 1
    if (data.r1) {
        stateData.r1.volts = data.r1.volts || 0;
        stateData.r1.amps = data.r1.amps || 0;
        stateData.r1.watts = data.r1.watts || 0;
        stateData.r1.kwh = data.r1.kwh || 0;
        stateData.r1.lamp = data.r1.lamp;
        stateData.r1.socket = data.r1.socket;

        document.getElementById('r1_volts').innerText = stateData.r1.volts.toFixed(1);
        document.getElementById('r1_amps').innerText = stateData.r1.amps.toFixed(2);
        document.getElementById('r1_watts').innerText = stateData.r1.watts.toFixed(1);
        
        const activeKwhR1 = Math.max(0, stateData.r1.kwh - stateData.r1.baseKwhOffset);
        document.getElementById('r1_kwh').innerText = activeKwhR1.toFixed(3);
        
        stateData.r1.grossElecCost = activeKwhR1 * TARIF_LISTRIK_PER_KWH;
        document.getElementById('r1_elec_cost').innerText = formatRupiah(stateData.r1.grossElecCost);

        document.getElementById('switch_r1_lamp').checked = data.r1.lamp;
        document.getElementById('switch_r1_socket').checked = data.r1.socket;
    }

    // Ruangan 2
    if (data.r2) {
        stateData.r2.volts = data.r2.volts || 0;
        stateData.r2.amps = data.r2.amps || 0;
        stateData.r2.watts = data.r2.watts || 0;
        stateData.r2.kwh = data.r2.kwh || 0;
        stateData.r2.lamp = data.r2.lamp;
        stateData.r2.socket = data.r2.socket;

        document.getElementById('r2_volts').innerText = stateData.r2.volts.toFixed(1);
        document.getElementById('r2_amps').innerText = stateData.r2.amps.toFixed(2);
        document.getElementById('r2_watts').innerText = stateData.r2.watts.toFixed(1);
        
        const activeKwhR2 = Math.max(0, stateData.r2.kwh - stateData.r2.baseKwhOffset);
        document.getElementById('r2_kwh').innerText = activeKwhR2.toFixed(3);

        stateData.r2.grossElecCost = activeKwhR2 * TARIF_LISTRIK_PER_KWH;
        document.getElementById('r2_elec_cost').innerText = formatRupiah(stateData.r2.grossElecCost);

        document.getElementById('switch_r2_lamp').checked = data.r2.lamp;
        document.getElementById('switch_r2_socket').checked = data.r2.socket;
    }

    // Air & Tangki
    if (data.water) {
        stateData.water.distance = data.water.distance || 0;
        stateData.water.percent = data.water.percent || 0;
        
        if (data.water.pump && !stateData.water.pump) {
            pumpStartTime = Date.now();
        } else if (!data.water.pump && stateData.water.pump && pumpStartTime) {
            stateData.water.activeSeconds += (Date.now() - pumpStartTime) / 1000;
            pumpStartTime = null;
        }
        stateData.water.pump = data.water.pump;

        document.getElementById('waterDistance').innerText = stateData.water.distance.toFixed(1);
        document.getElementById('waterProgress').style.width = `${Math.min(100, Math.max(0, stateData.water.percent)).toFixed(0)}%`;
        document.getElementById('waterPercentText').innerText = `${Math.min(100, Math.max(0, stateData.water.percent)).toFixed(0)}% Terisi`;

        const pumpBadge = document.getElementById('pumpBadge');
        if (data.water.pump) {
            pumpBadge.className = "text-xs font-semibold px-3 py-1 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 animate-pulse";
            pumpBadge.innerText = "Pompa: MENYALA";
        } else {
            pumpBadge.className = "text-xs font-semibold px-3 py-1 rounded-full bg-slate-800 text-slate-400 border border-slate-700";
            pumpBadge.innerText = "Pompa: IDLE";
        }

        let livePumpSecs = stateData.water.activeSeconds;
        if (data.water.pump && pumpStartTime) livePumpSecs += (Date.now() - pumpStartTime) / 1000;
        
        stateData.water.totalCost = livePumpSecs * TARIF_AIR_PER_DETIK;
    }

    // Pembagian Biaya Air & Net Balance
    const waterCostPerRoom = stateData.water.totalCost / 2;

    document.getElementById('totalWaterCost').innerText = formatRupiah(stateData.water.totalCost);
    document.getElementById('waterCostPerRoom').innerText = formatRupiah(waterCostPerRoom);

    document.getElementById('r1_water_cost').innerText = formatRupiah(waterCostPerRoom);
    document.getElementById('r2_water_cost').innerText = formatRupiah(waterCostPerRoom);

    const r1Gross = stateData.r1.grossElecCost + waterCostPerRoom;
    const r1Net = Math.max(0, r1Gross - stateData.r1.paidAmount);
    document.getElementById('r1_paid_amount').innerText = `- ${formatRupiah(stateData.r1.paidAmount)}`;
    document.getElementById('r1_total_cost').innerText = formatRupiah(r1Net);

    const r2Gross = stateData.r2.grossElecCost + waterCostPerRoom;
    const r2Net = Math.max(0, r2Gross - stateData.r2.paidAmount);
    document.getElementById('r2_paid_amount').innerText = `- ${formatRupiah(stateData.r2.paidAmount)}`;
    document.getElementById('r2_total_cost').innerText = formatRupiah(r2Net);
}

// ==========================================
// 5. TRANSAKSI & RIWAYAT PEMBAYARAN
// ==========================================
function processPayment(roomNum) {
    const inputEl = document.getElementById(`payInputR${roomNum}`);
    const payVal = parseFloat(inputEl.value);

    if (isNaN(payVal) || payVal <= 0) {
        alert("Masukkan nominal angka pembayaran yang valid!");
        return;
    }

    const waterCostPerRoom = stateData.water.totalCost / 2;

    if (roomNum === 1) {
        stateData.r1.paidAmount += payVal;
        const r1Gross = stateData.r1.grossElecCost + waterCostPerRoom;
        const netCost = Math.max(0, r1Gross - stateData.r1.paidAmount);
        addHistoryLog(`Ruangan 1`, payVal, netCost, `Pembayaran Parsial`);
    } else if (roomNum === 2) {
        stateData.r2.paidAmount += payVal;
        const r2Gross = stateData.r2.grossElecCost + waterCostPerRoom;
        const netCost = Math.max(0, r2Gross - stateData.r2.paidAmount);
        addHistoryLog(`Ruangan 2`, payVal, netCost, `Pembayaran Parsial`);
    }

    inputEl.value = "";
    updateDashboard({});
    alert(`Pembayaran sebesar ${formatRupiah(payVal)} berhasil dicatat!`);
}

function handleSlideReset(roomNum, sliderEl) {
    if (sliderEl.checked) {
        if (confirm(`Konfirmasi pelunasan total dan reset tagihan Ruangan ${roomNum}?`)) {
            if (roomNum === 1) {
                stateData.r1.baseKwhOffset = stateData.r1.kwh;
                stateData.r1.grossElecCost = 0;
                stateData.r1.paidAmount = 0;
                addHistoryLog(`Ruangan 1`, 0, 0, `Pelunasan Total / Reset`);
            } else if (roomNum === 2) {
                stateData.r2.baseKwhOffset = stateData.r2.kwh;
                stateData.r2.grossElecCost = 0;
                stateData.r2.paidAmount = 0;
                addHistoryLog(`Ruangan 2`, 0, 0, `Pelunasan Total / Reset`);
            }
        }
        setTimeout(() => { sliderEl.checked = false; }, 400);
        updateDashboard({});
    }
}

function addHistoryLog(roomName, payAmount, remBalance, note) {
    const tbody = document.getElementById('paymentHistoryTable');
    if (tbody.children[0] && tbody.children[0].children.length === 1) {
        tbody.innerHTML = ""; 
    }

    const nowStr = new Date().toLocaleString('id-ID');
    const row = document.createElement('tr');
    row.className = "hover:bg-slate-800/50 transition border-b border-slate-800/50";
    row.innerHTML = `
        <td class="p-3 text-slate-300">${nowStr}</td>
        <td class="p-3 font-semibold text-slate-200">${roomName}</td>
        <td class="p-3 text-emerald-400 font-medium">${formatRupiah(payAmount)}</td>
        <td class="p-3 text-amber-400 font-medium">${formatRupiah(remBalance)}</td>
        <td class="p-3 text-slate-400"><span class="px-2 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700">${note}</span></td>
    `;
    tbody.prepend(row);
}

function formatRupiah(val) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
}

// ==========================================
// 6. INTEGRASI GOOGLE AI STUDIO (GEMINI API)
// ==========================================
async function fetchGeminiAPI(promptText) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
        return "Error: Kunci API Gemini belum diatur. Mohon isi variabel GEMINI_API_KEY di file app.js.";
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }]
            })
        });

        const data = await response.json();
        
        if (data.error) {
            console.error("[Gemini API Error]:", data.error);
            return `Error API (${data.error.code}): ${data.error.message}`;
        }
        
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            return data.candidates[0].content.parts[0].text;
        }
        return "Gagal menerima balasan dari AI.";
    } catch (err) {
        console.error("[Gemini Fetch Exception]:", err);
        return "Kesalahan Koneksi API: " + err.message;
    }
}

function appendChatMessage(sender, text, isUser = false) {
    const chatHistory = document.getElementById('aiChatHistory');
    const msgDiv = document.createElement('div');
    
    if (isUser) {
        msgDiv.className = "bg-slate-800/80 border border-slate-700/60 p-3 rounded-lg text-slate-200 ml-8 text-right";
        msgDiv.innerHTML = `<span class="font-semibold text-blue-400 block mb-1">Anda:</span> ${text}`;
    } else {
        msgDiv.className = "bg-indigo-950/40 border border-indigo-800/40 p-3 rounded-lg text-slate-300 mr-8";
        msgDiv.innerHTML = `<span class="font-semibold text-indigo-400 block mb-1"><i class="fa-solid fa-robot mr-1"></i> ${sender}:</span> ${text.replace(/\n/g, '<br>')}`;
    }
    chatHistory.appendChild(msgDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function handleChatKeyPress(e) {
    if (e.key === 'Enter') sendUserChat();
}

async function sendUserChat() {
    const inputEl = document.getElementById('aiUserQuery');
    const btnEl = document.getElementById('btnSendChat');
    const query = inputEl.value.trim();

    if (!query) return;

    appendChatMessage("Anda", query, true);
    inputEl.value = "";
    btnEl.disabled = true;

    const contextData = `
        [Konteks Data IoT Sistem]
        - Ruangan 1: Tegangan=${stateData.r1.volts}V, Arus=${stateData.r1.amps}A, Daya=${stateData.r1.watts}W, kWh=${stateData.r1.kwh.toFixed(3)}, Biaya Gross=Rp ${stateData.r1.grossElecCost}
        - Ruangan 2: Tegangan=${stateData.r2.volts}V, Arus=${stateData.r2.amps}A, Daya=${stateData.r2.watts}W, kWh=${stateData.r2.kwh.toFixed(3)}, Biaya Gross=Rp ${stateData.r2.grossElecCost}
        - Tangki Air: Jarak=${stateData.water.distance}cm, Status Pompa=${stateData.water.pump ? "Aktif":"Mati"}, Kapasitas=${stateData.water.percent}%, Biaya Air=Rp ${stateData.water.totalCost}

        Pertanyaan Pengguna: "${query}"
        Tugas: Jawab pertanyaan pengguna secara ramah, singkat, dan berikan saran berbasis data IoT di atas.
    `;

    const aiReply = await fetchGeminiAPI(contextData);
    appendChatMessage("Asisten AI", aiReply, false);
    btnEl.disabled = false;
}

async function analyzeWithGemini() {
    const btnEl = document.getElementById('btnAnalyze');
    btnEl.disabled = true;

    appendChatMessage("Asisten AI", "<i class='fa-solid fa-spinner animate-spin mr-1'></i> Menganalisis data efisiensi energi & air...", false);

    const promptText = `
        Berikan analisis singkat (2 paragraf) berdasarkan data berikut:
        - Ruangan 1: Tegangan=${stateData.r1.volts}V, Arus=${stateData.r1.amps}A, Daya=${stateData.r1.watts}W, kWh=${stateData.r1.kwh.toFixed(3)}
        - Ruangan 2: Tegangan=${stateData.r2.volts}V, Arus=${stateData.r2.amps}A, Daya=${stateData.r2.watts}W, kWh=${stateData.r2.kwh.toFixed(3)}
        - Air: Distance=${stateData.water.distance}cm, Percent Tank=${stateData.water.percent}%, Biaya Air=Rp ${stateData.water.totalCost}

        Tuliskan:
        1. Analisis efisiensi energi saat ini.
        2. Rekomendasi hemat energi & perkiraan tagihan bulanan.
    `;

    const aiReply = await fetchGeminiAPI(promptText);
    appendChatMessage("Analisis Otomatis AI", aiReply, false);
    btnEl.disabled = false;
}