// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);
const setStatus = (el, msg) => (el.textContent = msg);

// ---------- Elements ----------
const startBtn = $('startBtn');
const stopBtn = $('stopBtn');
const micBtn = $('micBtn');
const questionBox = $('questionBox');
const notes = $('notes');
const bar = $('bar');
const progressText = $('progressText');
const surveyStatus = $('surveyStatus');

const phoneInput = $('phone');
const callBtn = $('callBtn');
const callStatus = $('callStatus');

// ---------- Survey content ----------
// Profile maker questions
const profileQuestions = [
    "Please tell me your name.",
    "What is the location of your farm?",
    "How large is your farm in acres or hectares?",
    "What crops do you primarily grow?",
    "Do you have any organic certifications?",
    "How do you currently sell your produce?",
    "What are your biggest farming challenges?",
    "What is your contact phone number?"
];
const profileKeys = ['name', 'location', 'farmSize', 'crops', 'organic', 'selling', 'challenges', 'contact'];

let idx = 0;
let active = false;
let isListening = false;
let recognition = null;
let currentMode = 'welcome'; // 'welcome', 'profile', 'doubt', 'buying'
let awaitingChoice = false;
const profileData = {};
const doubtConversationHistory = []; // Store conversation history for doubt solver

// Session Management
let currentSession = null;
const sessionData = {
    id: null,
    startTime: null,
    endTime: null,
    mode: null,
    data: {},
    transcript: [],
    status: 'inactive' // 'active', 'completed', 'terminated', 'inactive'
};

// ---------- Session Management ----------
function startSession(mode) {
    currentSession = {
        id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        startTime: new Date().toISOString(),
        endTime: null,
        mode: mode,
        data: {},
        transcript: [],
        status: 'active'
    };

    console.log(`Session Started: ${currentSession.id} (Mode: ${mode})`);
    return currentSession.id;
}

function endSession(reason = 'completed') {
    if (!currentSession) return null;

    currentSession.endTime = new Date().toISOString();
    currentSession.status = reason;

    // Calculate session duration
    const duration = new Date(currentSession.endTime) - new Date(currentSession.startTime);
    currentSession.duration = Math.round(duration / 1000); // in seconds

    console.log(`Session Ended: ${currentSession.id} (${reason}) - Duration: ${currentSession.duration}s`);

    // Auto-export session data
    exportSessionData(currentSession);

    const sessionId = currentSession.id;
    currentSession = null; // Clear current session
    return sessionId;
}

function addToTranscript(speaker, message, timestamp = null) {
    if (!currentSession) return;

    currentSession.transcript.push({
        timestamp: timestamp || new Date().toISOString(),
        speaker: speaker, // 'user', 'ai', 'system'
        message: message,
        mode: currentMode
    });
}

function updateSessionData(key, value) {
    if (!currentSession) return;
    currentSession.data[key] = value;
}

function checkSessionEndCommands(text) {
    const endCommands = [
        /end\s+session/i,
        /finish\s+session/i,
        /stop\s+session/i,
        /complete\s+session/i,
        /session\s+end/i,
        /session\s+complete/i,
        /that's\s+all\s+for\s+today/i,
        /i'm\s+done/i,
        /we're\s+done/i,
        /session\s+over/i
    ];

    return endCommands.some(pattern => pattern.test(text.trim()));
}

// ---------- Audio Visualizer (mic reactive) ----------
const DOT_COUNT = 220;
const dots = [];
let audioContext = null, analyser = null, dataArray = null, micStream = null, animId = null;

function fibonacciSphere(samples, radius) {
    const pts = [];
    const offset = 2 / samples;
    const inc = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < samples; i++) {
        const y = ((i * offset) - 1) + (offset / 2);
        const r = Math.sqrt(1 - y * y);
        const phi = i * inc;
        const x = Math.cos(phi) * r;
        const z = Math.sin(phi) * r;
        pts.push({ x: x * radius, y: y * radius, z: z * radius });
    }
    return pts;
}

function createDots() {
    const viz = $('visualizer');
    if (!viz) return;
    const pts = fibonacciSphere(DOT_COUNT, 150);
    pts.forEach((p) => {
        const el = document.createElement('div');
        el.className = 'dot';
        viz.appendChild(el);
        dots.push({ el, ...p, base: 3 + Math.random() * 2, phase: Math.random() * Math.PI * 2 });
    });
}

async function initVisualizer() {
    try {
        // Ask mic only when survey starts
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(micStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        source.connect(analyser);
        if (!animId) animateViz();
    } catch (e) {
        console.warn('Visualizer init failed:', e);
    }
}

function animateViz() {
    animId = requestAnimationFrame(animateViz);
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);
    let sum = 0; for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const avg = sum / dataArray.length / 255; // 0..1
    const now = Date.now() * 0.001;
    const visible = Math.floor(DOT_COUNT * (0.35 + avg * 0.65));

    dots.forEach((d, i) => {
        // rotate a bit for 3D feel
        const rotY = now * 0.7, rotX = Math.sin(now * 0.5) * 0.25;
        let x = d.x * Math.cos(rotY) - d.z * Math.sin(rotY);
        let z = d.x * Math.sin(rotY) + d.z * Math.cos(rotY);
        let y = d.y * Math.cos(rotX) - z * Math.sin(rotX);
        z = d.y * Math.sin(rotX) + z * Math.cos(rotX);

        // idle float
        x += Math.sin(now * 1.8 + d.phase) * 8;
        y += Math.cos(now * 1.2 + d.phase) * 6;

        const scale = 380 / (380 + z);
        const sx = 190 + x * scale;
        const sy = 190 + y * scale;

        const el = d.el;
        const size = d.base + avg * 14;
        const opacity = i < visible ? 0.45 + avg * 0.5 : 0.1;
        const hue = 190 + avg * 70;

        el.style.opacity = opacity;
        el.style.width = el.style.height = `${size}px`;
        el.style.backgroundColor = `hsl(${hue},80%,${60 + avg * 30}%)`;
        el.style.left = `${sx - size / 2}px`;
        el.style.top = `${sy - size / 2}px`;
    });
}

function stopVisualizer() {
    if (animId) cancelAnimationFrame(animId), animId = null;
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
    analyser = null; dataArray = null;
}

// ---------- TTS (browser) ----------
function speak(text, autoListen = false) {
    return new Promise((resolve, reject) => {
        try {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.rate = 0.95; u.pitch = 1.05; u.volume = 1;
            u.onend = () => {
                if (autoListen && active && recognition && !isListening) {
                    // Auto-start listening after AI finishes speaking
                    setTimeout(() => {
                        try {
                            recognition.start();
                        } catch (e) {
                            console.warn('Auto-listen failed:', e);
                            micBtn.disabled = false;
                        }
                    }, 500); // Small delay to ensure speech synthesis is fully done
                }
                resolve();
            };
            u.onerror = (e) => reject(e.error || e);
            window.speechSynthesis.speak(u);
        } catch (e) { reject(e); }
    });
}

// ---------- STT (Web Speech) ----------
function initRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        setStatus(surveyStatus, 'Speech recognition not supported.');
        return null;
    }
    const r = new SR();
    r.lang = 'en-US'; r.continuous = false; r.interimResults = false; r.maxAlternatives = 1;

    r.onstart = () => { isListening = true; micBtn.disabled = true; setStatus(surveyStatus, 'Listening...'); };
    r.onend = () => { isListening = false; micBtn.disabled = false; };
    r.onerror = (e) => { setStatus(surveyStatus, `STT error: ${e.error}`); };

    r.onresult = (ev) => {
        let text = ''; for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
        text = text.trim();
        if (text) {
            // Log user input to transcript
            addToTranscript('user', text);

            // Check for session end commands first
            if (checkSessionEndCommands(text)) {
                handleSessionEnd(text);
                return;
            }

            if (awaitingChoice) {
                handleUserChoice(text);
                return;
            }

            if (currentMode === 'profile') {
                notes.value += `${profileQuestions[idx]}\n→ ${text}\n\n`;
                profileData[profileKeys[idx]] = text;
                updateSessionData(profileKeys[idx], text); // Update session data
                nextProfileQuestion();
            } else if (currentMode === 'doubt') {
                handleDoubtSolverUpdated(text);
            } else if (currentMode === 'buying') {
                handleBuyingToolUpdated(text);
            }
        } else {
            setStatus(surveyStatus, 'No speech detected.');
        }
    };
    return r;
}

// Handle session end commands
async function handleSessionEnd(command) {
    addToTranscript('system', `Session end command received: ${command}`);

    if (currentSession) {
        const sessionId = endSession('user_terminated');
        await speak(`Session ${sessionId.split('_')[1]} has been completed. Thank you!`);

        setTimeout(async () => {
            await speak("Would you like to start a new session? Say 'menu' to return to the main menu.", true);
            questionBox.textContent = "Say 'menu' for main menu or start a new session";
            setStatus(surveyStatus, 'Session ended - say "menu" for options');
            currentMode = 'welcome';
            awaitingChoice = true;
        }, 1000);
    } else {
        await speak("No active session to end. Say 'menu' to return to the main menu.", true);
        currentMode = 'welcome';
        awaitingChoice = true;
    }
}

// ---------- Survey flow ----------
function renderProgress() {
    if (currentMode === 'profile') {
        const p = Math.round((idx / profileQuestions.length) * 100);
        bar.style.width = `${p}%`;
        progressText.textContent = `${idx} / ${profileQuestions.length}`;
    } else {
        bar.style.width = `0%`;
        progressText.textContent = `Ready`;
    }
}

// Welcome function
async function welcomeUser() {
    currentMode = 'welcome';
    awaitingChoice = true;
    idx = 0;
    renderProgress();
    questionBox.textContent = "How can I assist you today?";

    await speak("Hello! How can I assist you today? Please say: 1 for profile maker, 2 for doubt solver, or 3 for buying a tool.", true);
    setStatus(surveyStatus, 'Listening for your choice (1, 2, or 3)...');
}

// Handle user choice
async function handleUserChoice(choice) {
    awaitingChoice = false;
    const cleanChoice = choice.toLowerCase().replace(/[^123]/g, '');

    if (cleanChoice.includes('1') || choice.toLowerCase().includes('one') || choice.toLowerCase().includes('profile')) {
        currentMode = 'profile';
        startSession('profile'); // Start profile session
        idx = 0;
        Object.keys(profileData).forEach(k => delete profileData[k]);
        notes.value = 'PROFILE MAKER SESSION\n\n';
        addToTranscript('system', 'Profile maker session started');
        await speak("Let's create your profile. Please tell me your name.", true);
        addToTranscript('ai', "Let's create your profile. Please tell me your name.");
        questionBox.textContent = profileQuestions[idx];
        renderProgress();
        setStatus(surveyStatus, 'Listening for your name...');
    } else if (cleanChoice.includes('2') || choice.toLowerCase().includes('two') || choice.toLowerCase().includes('doubt')) {
        currentMode = 'doubt';
        startSession('doubt'); // Start doubt solver session
        doubtConversationHistory.length = 0; // Clear conversation history for new session
        notes.value = 'CONVERSATIONAL DOUBT SOLVER SESSION\n\n';
        addToTranscript('system', 'Doubt solver session started');
        await speak("Hello! I'm your farming advisor. Please tell me your farming question or doubt, and I'll help you with detailed advice. We can have a conversation until you say 'thank you' when you're done.", true);
        addToTranscript('ai', "Hello! I'm your farming advisor. Please tell me your farming question or doubt, and I'll help you with detailed advice. We can have a conversation until you say 'thank you' when you're done.");
        questionBox.textContent = "What's your farming question? (We'll have a conversation until you say 'thank you')";
        renderProgress();
        setStatus(surveyStatus, 'Listening for your farming question...');
    } else if (cleanChoice.includes('3') || choice.toLowerCase().includes('three') || choice.toLowerCase().includes('buy') || choice.toLowerCase().includes('tool')) {
        currentMode = 'buying';
        startSession('buying'); // Start buying tool session
        notes.value = 'BUYING TOOL SESSION\n\n';
        addToTranscript('system', 'Buying tool session started');
        await speak("What are your requirements for the tool? I will pass them to the vendors.", true);
        addToTranscript('ai', "What are your requirements for the tool? I will pass them to the vendors.");
        questionBox.textContent = "Describe the tool you want to buy";
        renderProgress();
        setStatus(surveyStatus, 'Listening for your tool requirements...');
    } else {
        await speak("Sorry, I did not understand that. Please say 1 for profile maker, 2 for doubt solver, or 3 for buying a tool.", true);
        awaitingChoice = true;
        setStatus(surveyStatus, 'Try again - listening for 1, 2, or 3...');
    }
}

// Profile maker flow
function nextProfileQuestion() {
    idx++;
    renderProgress();
    if (idx >= profileQuestions.length) {
        setStatus(surveyStatus, 'Profile creation complete!');
        addToTranscript('system', 'Profile creation completed');

        // Copy profile data to session
        if (currentSession) {
            currentSession.data = { ...profileData };
        }

        speak('Your profile has been created successfully!').finally(() => {
            endSession('completed'); // End session with completion status
            exportProfile();
            stopSurvey(false);
        });
        return;
    }
    questionBox.textContent = profileQuestions[idx];
    setTimeout(() => {
        const question = profileQuestions[idx];
        speak(question, true).then(() => {
            addToTranscript('ai', question);
            setStatus(surveyStatus, 'Listening for your answer...');
        });
    }, 500);
}

// Doubt solver functionality
// Conversational Doubt solver functionality
async function handleDoubtSolver(doubt) {
    notes.value += `User: ${doubt}\n\n`;
    setStatus(surveyStatus, 'Processing your question...');

    try {
        // Call Gemini API for conversational doubt solving
        const response = await fetch('/api/solve-doubt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                doubt: doubt,
                conversationHistory: doubtConversationHistory
            })
        });

        if (!response.ok) throw new Error(await response.text());

        const data = await response.json();
        const answer = data.answer || "I'm sorry, I couldn't solve that doubt at the moment.";
        const isConversationEnd = data.isConversationEnd || false;

        notes.value += `Advisor: ${answer}\n\n`;
        addToTranscript('ai', answer); // Log AI response

        // Update session data with doubt/answer pair
        if (currentSession) {
            if (!currentSession.data.conversations) {
                currentSession.data.conversations = [];
            }
            currentSession.data.conversations.push({
                question: doubt,
                answer: answer,
                timestamp: new Date().toISOString()
            });
        }

        // Add to conversation history (keep last 5 exchanges to avoid token limits)
        doubtConversationHistory.push({
            question: doubt,
            answer: answer
        });

        // Keep only last 5 exchanges to manage token limits
        if (doubtConversationHistory.length > 5) {
            doubtConversationHistory.shift();
        }

        await speak(answer);

        // Handle conversation flow
        if (isConversationEnd) {
            // User said thank you - end conversation and offer menu
            addToTranscript('system', 'Doubt solver session ended by user (thank you)');
            endSession('completed'); // End session when user says thank you

            setTimeout(async () => {
                await speak("Would you like to use another service? Say 'menu' to return to the main menu.", true);
                addToTranscript('ai', "Would you like to use another service? Say 'menu' to return to the main menu.");
                questionBox.textContent = "Say 'menu' to return to main menu";
                setStatus(surveyStatus, 'Listening - say "menu" to return to main menu');
                // Clear conversation history for next session
                doubtConversationHistory.length = 0;
            }, 1000);
        } else {
            // Continue conversation - ask for next question
            setTimeout(async () => {
                const followUp = "Is there anything else you'd like to know about farming? Or say 'thank you' when you're done.";
                await speak(followUp, true);
                addToTranscript('ai', followUp);
                questionBox.textContent = "Ask another farming question or say 'thank you' to finish";
                setStatus(surveyStatus, 'Listening for your next question...');
            }, 1000);
        }

    } catch (error) {
        const fallbackAnswer = "I'm sorry, I'm having trouble connecting to solve your doubt right now. Please try again later.";
        notes.value += `Advisor: ${fallbackAnswer}\n\n`;
        await speak(fallbackAnswer);
        setTimeout(async () => {
            await speak("Please try asking your question again, or say 'thank you' to end the conversation.", true);
            setStatus(surveyStatus, 'Listening - try again or say "thank you"');
        }, 1000);
    }
}

// Buying tool functionality
async function handleBuyingTool(requirements) {
    notes.value += `Tool Requirements: ${requirements}\n\n`;
    setStatus(surveyStatus, 'Processing your requirements...');

    const confirmation = `I understand you need: ${requirements}. I will forward these requirements to our vendor network. They will contact you with suitable options and pricing.`;

    notes.value += `System Response: ${confirmation}\n\n`;
    addToTranscript('ai', confirmation);

    // Update session data with tool requirements
    if (currentSession) {
        currentSession.data.toolRequirements = requirements;
        currentSession.data.confirmation = confirmation;
        currentSession.data.timestamp = new Date().toISOString();
    }

    await speak(confirmation);

    // Save the requirements
    const toolRequest = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        requirements: requirements,
        status: 'forwarded_to_vendors',
        sessionId: currentSession ? currentSession.id : null
    };

    exportToolRequest(toolRequest);

    // End the buying session
    addToTranscript('system', 'Tool requirements processed and forwarded to vendors');
    endSession('completed');

    setTimeout(async () => {
        const followUp = "Is there anything else I can help you with? Say 'menu' to return to the main menu.";
        await speak(followUp, true);
        addToTranscript('ai', followUp);
        questionBox.textContent = "Say 'menu' for main menu or describe another tool need";
        setStatus(surveyStatus, 'Listening - say "menu" or another tool requirement');
    }, 1000);
}

async function startSurvey() {
    // mic perm quick check
    try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach(t => t.stop());
    } catch {
        setStatus(surveyStatus, 'Microphone permission required.');
        return;
    }

    // visualizer
    await initVisualizer();

    recognition = initRecognition();
    if (!recognition) return;

    active = true;
    startBtn.disabled = true; stopBtn.disabled = false; micBtn.disabled = true;

    setStatus(surveyStatus, 'Starting system...');
    renderProgress();

    // Start with welcome message
    await welcomeUser();
}

function stopSurvey(exportNow = true) {
    if (recognition && isListening) recognition.stop();

    // Handle active session when stopping
    if (currentSession) {
        addToTranscript('system', 'System stopped by user');
        endSession('user_terminated');
    }

    active = false;
    startBtn.disabled = false; stopBtn.disabled = true; micBtn.disabled = true;
    setStatus(surveyStatus, 'System stopped!');
    stopVisualizer();
    currentMode = 'welcome';
    awaitingChoice = false;
}

micBtn.addEventListener('click', () => {
    if (!active) { setStatus(surveyStatus, 'Start the system first.'); return; }
    if (!recognition) { setStatus(surveyStatus, 'STT not available.'); return; }
    if (isListening) { setStatus(surveyStatus, 'Already listening...'); return; }

    // Manual fallback option if auto-listening fails
    try {
        micBtn.disabled = true;
        recognition.start();
        setStatus(surveyStatus, 'Manual listening started...');
    }
    catch (e) { setStatus(surveyStatus, `Could not start listening: ${e.message}`); micBtn.disabled = false; }
});

startBtn.addEventListener('click', startSurvey);
stopBtn.addEventListener('click', () => stopSurvey(true));

// Enhanced speech recognition to handle menu commands
function enhancedRecognitionHandler(text) {
    if (text.toLowerCase().includes('menu') || text.toLowerCase().includes('main menu')) {
        welcomeUser();
        return true;
    }
    return false;
}

// Update the doubt solver to handle menu command
async function handleDoubtSolverUpdated(doubt) {
    if (enhancedRecognitionHandler(doubt)) return;
    await handleDoubtSolver(doubt);
}

// Update buying tool to handle menu command  
async function handleBuyingToolUpdated(requirements) {
    if (enhancedRecognitionHandler(requirements)) return;
    await handleBuyingTool(requirements);
}

// Save/export functions
function exportSessionData(session) {
    if (!session) return;

    const sessionExport = {
        ...session,
        exportedAt: new Date().toISOString(),
        sessionSummary: {
            totalInteractions: session.transcript.length,
            userMessages: session.transcript.filter(t => t.speaker === 'user').length,
            aiMessages: session.transcript.filter(t => t.speaker === 'ai').length,
            systemMessages: session.transcript.filter(t => t.speaker === 'system').length
        }
    };

    downloadJSON(sessionExport, `session-${session.mode}-${session.id}.json`);
    console.log(`Session data exported: session-${session.mode}-${session.id}.json`);
}

function exportProfile() {
    const data = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        profile: profileData,
        type: 'profile'
    };
    downloadJSON(data, `profile-${data.id}.json`);
}

function exportToolRequest(toolData) {
    downloadJSON(toolData, `tool-request-${toolData.id}.json`);
}

function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// ---------- Phone call (server-side) + local audio simulation ----------
callBtn.addEventListener('click', async () => {
    const raw = (phoneInput.value || '').trim();
    if (!raw.replace(/\D/g, '').match(/^\d{10,}$/)) {
        setStatus(callStatus, 'Enter a valid phone number (min 10 digits).'); return;
    }
    setStatus(callStatus, 'Initiating agent call...');
    // Play local simulation so you hear something in browser:
    speak('Calling the user now. The agent will speak with them on the phone.');

    try {
        const res = await fetch('/api/start-call', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to_number: raw })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const extra = [];
        if (data.callSid) extra.push(`Twilio: ${data.callSid}`);
        if (data.conversation_id) extra.push(`Conversation: ${data.conversation_id}`);
        setStatus(callStatus, `Call started. ${extra.join(' | ') || ''}`);
        // Another small local sim line:
        speak('The call is in progress.');
    } catch (e) {
        setStatus(callStatus, `Call failed: ${e.message}`);
        speak('Sorry, the call could not be started. Please check your configuration and try again.');
    }
});

// ---------- Boot ----------
createDots();
window.addEventListener('beforeunload', () => stopVisualizer());
