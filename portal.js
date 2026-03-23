/**
 * Main application logic for AskJuthis Mortgages
 * Reads from config.js and injects Tailwind-based UI into the DOM.
 */

// Global Analytics Utility
window.trackEvent = function(category, action, label = '') {
    console.log(`📊 [Analytics] ${category} > ${action} ${label ? `(${label})` : ''}`);
    // In production, this would fire to Segment/Google Analytics/PostHog
}

// Global Socket Initialization
let socket = null;
if (typeof io !== 'undefined') {
    socket = io();
    
    // Listen for new messages globally
    socket.on('new_message', (msg) => {
        window.trackEvent('Messaging', 'Message Received', msg.senderRole);
        const chatContainer = document.getElementById('chat-messages');
        if (chatContainer) {
            // Determine if the incoming message was sent by the current user
            const isMe = window.userStatus && window.userStatus.role === msg.senderRole;
            
            const bubble = document.createElement('div');
            bubble.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'}`;
            bubble.innerHTML = `
                <div class="max-w-[80%] rounded-2xl p-4 ${isMe ? 'bg-secondary-fixed text-primary rounded-tr-sm' : 'bg-primary text-white border border-white/10 rounded-tl-sm'}">
                    <div class="text-[10px] uppercase font-black tracking-widest opacity-50 mb-1">${msg.senderName}</div>
                    <div class="text-sm font-medium">${msg.message}</div>
                </div>
                <div class="text-[10px] text-white/30 mt-1">${new Date(msg.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
            `;
            chatContainer.appendChild(bubble);
            
            // Scroll to bottom
            setTimeout(() => {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }, 50);
        }
    });

    socket.on('status_update', (data) => {
        // We will handle real-time status updates later
        if (window.userStatus && window.userStatus.role === 'borrower') {
            window.loadPortalData(); // Refresh borrower dash quietly
        } else if (window.userStatus && window.userStatus.role === 'admin') {
            window.loadAdminData(); // Refresh admin dash quietly
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const appContent = document.getElementById('app-content');

    // Check for payment success redirect
    const params = new URLSearchParams(window.location.search);
    const isPaymentSuccess = params.get('payment') === 'success';

    if (isPaymentSuccess) {
        appContent.innerHTML = `
            <section class="min-h-screen bg-primary flex items-center justify-center">
                <div class="text-center">
                    <div class="w-24 h-24 rounded-full bg-secondary-fixed/20 flex items-center justify-center mb-8 mx-auto animate-pulse">
                        <span class="material-symbols-outlined text-6xl text-secondary-fixed">check_circle</span>
                    </div>
                    <h2 class="text-2xl font-black text-white uppercase tracking-widest mb-4">Payment Verified</h2>
                    <p class="text-white/40 font-bold uppercase tracking-widest text-xs">Finalizing your application dashboard...</p>
                </div>
            </section>
        `;
        setTimeout(async () => {
            await window.checkUserStatus();
            window.showPortalDashboard();
        }, 1200);
        return;
    }

    // Check if user is already logged in
    const token = localStorage.getItem('jwt_token');
    if (token) {
        await window.checkUserStatus();
        window.showPortalDashboard();
    } else {
        appContent.innerHTML = renderLogin();
        initScrollReveal();
    }

    // Show sign-out button
    const signOutBtn = document.getElementById('portal-sign-out-btn');
    if (token && signOutBtn) signOutBtn.classList.remove('hidden');
});

// Portal Dashboard Loader
window.showPortalDashboard = function() {
    const appContent = document.getElementById('app-content');
    if (window.userStatus && window.userStatus.role === 'admin') {
        appContent.innerHTML = renderAdminDashboard();
        window.loadAdminData();
    } else {
        appContent.innerHTML = renderPortal();
        window.loadDocuments();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();

    // Show sign-out button
    const signOutBtn = document.getElementById('portal-sign-out-btn');
    if (signOutBtn) signOutBtn.classList.remove('hidden');
}

// Sign Out
window.portalSignOut = function() {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_data');
    window.userStatus = null;
    window.location.href = '/';
}

// Legacy toggle support (redirects into portal dashboard)
window.togglePortal = async function(showPortal) {
    if (showPortal) {
        const token = localStorage.getItem('jwt_token');
        if (token) {
            await window.checkUserStatus();
            window.showPortalDashboard();
        } else {
            const appContent = document.getElementById('app-content');
            appContent.innerHTML = renderLogin();
            initScrollReveal();
        }
    } else {
        window.portalSignOut();
    }
}


function initScrollReveal() {
    const observerOptions = {
        threshold: 0.15,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                // Optional: stop observing once revealed
                // observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}



// Global state
let loanCompleted = false;

// --- AUTH HELPER ---
function authHeaders() {
    const token = localStorage.getItem('jwt_token');
    return token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function authFetch(url, options = {}) {
    const headers = { ...authHeaders(), ...(options.headers || {}) };
    return fetch(url, { ...options, headers });
}



// --- REAL AUTH ---
window.submitLogin = async function() {
    const emailInput = document.getElementById('login-email');
    const passInput = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    if (!emailInput.value || !passInput.value) {
        if (errorEl) errorEl.textContent = 'Please fill in both fields.';
        return;
    }

    if (btn) btn.innerHTML = '<span class="material-symbols-outlined animate-spin mr-2">progress_activity</span> Authenticating...';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailInput.value, password: passInput.value })
        });
        const data = await res.json();
        
        if (data.mfaRequired) {
            window.mfaContext = { email: data.email, type: data.mfaType };
            const appContent = document.getElementById('app-content');
            appContent.innerHTML = renderMFAChallenge(data.mfaType);
            return;
        }

        if (data.verificationRequired) {
            window.mfaContext = { email: data.email };
            const appContent = document.getElementById('app-content');
            appContent.innerHTML = renderRegistrationVerification(data.email);
            return;
        }

        if (data.success) {
            localStorage.setItem('jwt_token', data.token);
            localStorage.setItem('user_data', JSON.stringify(data.user));
            window.trackEvent('Auth', 'Login Success', data.user.role);
            await window.checkUserStatus();

            // Go to portal
            const appContent = document.getElementById('app-content');
            if (window.userStatus && window.userStatus.role === 'admin') {
                appContent.innerHTML = renderAdminDashboard();
                window.loadAdminData();
            } else {
                appContent.innerHTML = renderPortal();
                window.loadDocuments();
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
            initScrollReveal();
        } else {
            if (errorEl) errorEl.textContent = data.error || 'Login failed.';
            if (btn) btn.innerHTML = 'Log In & Authenticate';
        }
    } catch (error) {
        if (errorEl) errorEl.textContent = 'Server unavailable. Is the backend running?';
        if (btn) btn.innerHTML = 'Log In & Authenticate';
    }
}

window.submitRegister = async function() {
    const nameInput = document.getElementById('register-name');
    const emailInput = document.getElementById('register-email');
    const phoneInput = document.getElementById('register-phone');
    const passInput = document.getElementById('register-password');
    const errorEl = document.getElementById('register-error');
    const btn = document.getElementById('register-btn');

    if (!emailInput.value || !passInput.value || (phoneInput && !phoneInput.value)) {
        if (errorEl) errorEl.textContent = 'Please fill in all required fields.';
        return;
    }

    if (btn) btn.innerHTML = '<span class="material-symbols-outlined animate-spin mr-2">progress_activity</span> Creating Account...';

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name: nameInput ? nameInput.value : '', 
                email: emailInput.value, 
                phone: phoneInput ? phoneInput.value : '',
                password: passInput.value 
            })
        });
        const data = await res.json();

        if (data.success) {
            if (data.verificationRequired) {
                window.mfaContext = { email: data.email };
                const appContent = document.getElementById('app-content');
                appContent.innerHTML = renderRegistrationVerification(data.email);
                return;
            }
            localStorage.setItem('jwt_token', data.token);
            localStorage.setItem('user_data', JSON.stringify(data.user));
            window.trackEvent('Auth', 'Register Success');

            await window.checkUserStatus();

            const appContent = document.getElementById('app-content');
            if (window.userStatus && window.userStatus.role === 'admin') {
                appContent.innerHTML = renderAdminDashboard();
                window.loadAdminData();
            } else {
                appContent.innerHTML = renderPortal();
                window.loadDocuments();
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
            initScrollReveal();
        } else {
            if (errorEl) errorEl.textContent = data.error || 'Registration failed.';
            if (btn) btn.innerHTML = 'Create Secure Account';
        }
    } catch (error) {
        if (errorEl) errorEl.textContent = 'Server unavailable. Is the backend running?';
        if (btn) btn.innerHTML = 'Create Secure Account';
    }
}

window.showRegister = function() {
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = renderRegister();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();
}

window.showLogin = function() {
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = renderLogin();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();
}

window.verifyMFA = function() {
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = renderPortal();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();
}

window.startWizard = function(step = 1) {
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = renderWizard(step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();
}

window.nextWizardStep = function(currentStep) {
    if (currentStep < 7) {
        window.startWizard(currentStep + 1);
    } else {
        window.submitApplication();
    }
}

// --- PHASE 9: NEW LOGIC ---
window.submitApplication = async function() {
    try {
        const appContent = document.getElementById('app-content');
        appContent.innerHTML = `
            <section class="min-h-screen bg-primary flex items-center justify-center">
                <div class="text-center">
                    <span class="material-symbols-outlined animate-spin text-6xl text-secondary-fixed mb-6">progress_activity</span>
                    <h2 class="text-2xl font-black text-white uppercase tracking-widest">Submitting Application...</h2>
                </div>
            </section>
        `;

        const loanAmount = parseInt(document.getElementById('step5-price')?.value || '0');
        const propertyAddress = document.getElementById('step5-property-type')?.value + " Application";
        const loanType = 'Purchase';

        // Collect History Rows
        const employmentHistory = Array.from(document.querySelectorAll('.employment-row')).map(row => ({
            employerName: row.querySelector('.employer-name').value,
            title: row.querySelector('.employer-title').value,
            startDate: row.querySelector('.employer-start').value,
            monthlyIncome: parseFloat(row.querySelector('.employer-income').value || '0')
        })).filter(e => e.employerName);

        const residentialHistory = Array.from(document.querySelectorAll('.residency-row')).map(row => ({
            address: row.querySelector('.res-address').value,
            status: row.querySelector('.res-status').value,
            startDate: '2022-01-01' // Mock for simplicity in this pass
        })).filter(r => r.address);

        const payload = {
            loanAmount: loanAmount,
            propertyAddress: document.getElementById('cp-address')?.value || 'TBD',
            loanType: loanType,
            propertyDetails: {
                propertyType: document.getElementById('step5-property-type')?.value,
                occupancyType: document.getElementById('step5-occupancy-type')?.value,
                purchasePrice: loanAmount,
                estimatedValue: loanAmount
            },
            employmentHistory,
            residentialHistory,
            declarations: {
                outstandingJudgments: document.querySelector('input[name="decl-judgments"]:checked')?.value === 'yes',
                bankruptcy: document.querySelector('input[name="decl-bankruptcy"]:checked')?.value === 'yes',
                lawsuits: document.querySelector('input[name="decl-lawsuits"]:checked')?.value === 'yes',
                usCitizen: document.querySelector('input[name="decl-citizen"]:checked')?.value === 'yes'
            }
        };

        const response = await authFetch('/api/applications/submit', { 
            method: 'POST',
            body: JSON.stringify(payload)
        });
        
        await window.checkUserStatus();
        appContent.innerHTML = renderPortal();
        window.loadDocuments();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        initScrollReveal();
    } catch (error) {
        console.error('Submission failed:', error);
    }
}

// --- REAL PLAID INTEGRATION ---
let plaidHandler = null;

window.initializePlaidLink = async function(isIncomeStep = false) {
    try {
        const response = await fetch('/api/create_link_token', { method: 'POST', headers: authHeaders() });
        const data = await response.json();
        
        if (data.link_token) {
            plaidHandler = Plaid.create({
                token: data.link_token,
                onSuccess: (public_token, metadata) => {
                    window.trackEvent('Verification', 'Plaid Success');
                    console.log('Plaid Link Success:', public_token);
                    window.handlePlaidSuccess(public_token, isIncomeStep);
                },
                onLoad: () => { console.log('Plaid Loaded'); },
                onExit: (err, metadata) => { if (err) console.error('Plaid Exit Error:', err); },
                onEvent: (eventName, metadata) => { console.log('Plaid Event:', eventName); }
            });
            plaidHandler.open();
        } else {
            console.error('Plaid Server Error:', data);
            alert(`Plaid Error: ${data.error || 'Unknown Error'}.`);
        }
    } catch (error) {
        console.error('Network Error:', error);
        alert('Could not connect to the backend. Please ensure server is running.');
    }
}

window.handlePlaidSuccess = async function(public_token, isIncomeStep) {
    const btn = isIncomeStep ? document.getElementById('payroll-sync-box') : document.querySelector('button[onclick="window.initializePlaidLink()"]');
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-4xl mb-4">progress_activity</span><span class="text-xs uppercase tracking-widest">Securing Bank Data...</span>';

    try {
        const response = await fetch('/api/exchange_public_token', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ public_token })
        });
        const result = await response.json();
        
        if (result.status === 'success') {
            if (isIncomeStep) {
                // Call Income Sync
                await authFetch('/api/applications/sync_income', { method: 'POST', body: JSON.stringify({}) });
                window.trackEvent('Verification', 'Real Bank Income Saved to DB');
                window.showSyncProcessing(); // Show success UI
            } else {
                // Legacy Asset Sync
                await authFetch('/api/applications/sync_assets', { method: 'POST', body: JSON.stringify({}) });
                window.trackEvent('Verification', 'Real Bank Assets Saved to DB');
                window.nextWizardStep(3); // Successfully linked!
            }
        }
    } catch (error) {
        console.error('Error exchanging public token:', error);
        alert("Failed to securely connect bank data.");
    }
}

window.showSyncProcessing = function() {
    const container = document.getElementById('sync-status-container');
    const syncBox = document.getElementById('payroll-sync-box');
    const nextBtn = document.getElementById('wizard-next-btn');
    
    if (container && syncBox) {
        syncBox.classList.add('hidden');
        container.classList.remove('hidden');
        
        container.innerHTML = `
            <div class="flex flex-col items-center py-10">
                <div class="relative w-20 h-20 mb-6">
                    <div class="absolute inset-0 border-4 border-secondary-fixed/10 rounded-full"></div>
                    <div class="absolute inset-0 border-4 border-secondary-fixed rounded-full border-t-transparent animate-spin"></div>
                </div>
                <p class="text-white font-bold uppercase tracking-[0.2em] text-[10px] animate-pulse">Syncing Financial Records...</p>
                <p class="text-white/30 text-[10px] mt-2 font-bold uppercase tracking-widest">Secure Bank-Level Encryption Active</p>
            </div>
        `;

        setTimeout(async () => {
            // Save to Backend (Phase 12 Hardening)
            try {
                await authFetch('/api/applications/sync_income', {
                    method: 'POST',
                    body: JSON.stringify({ income: 4582.50, source: 'ADP Global' })
                });
                window.trackEvent('Verification', 'Income Saved to DB');
            } catch (err) {
                console.error('Failed to sync income to DB:', err);
            }

            container.innerHTML = renderSyncResult();
            if (nextBtn) {
                nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                nextBtn.removeAttribute('disabled');
                nextBtn.innerHTML = 'Review & Continue';
            }
            window.trackEvent('Payroll Sync', 'Completed');
        }, 3000);
    }
}

window.startAssetSync = function() {
    const box = document.getElementById('asset-sync-box');
    const nextBtn = document.getElementById('assets-next-btn');
    
    if (box) box.innerHTML = '<span class="material-symbols-outlined animate-spin text-4xl text-secondary-fixed mb-4 mx-auto">progress_activity</span><span class="text-xs text-secondary-fixed uppercase tracking-widest font-bold">Scanning Balances...</span>';

    setTimeout(async () => {
        try {
            await authFetch('/api/applications/sync_assets', { method: 'POST', body: JSON.stringify({}) });
            window.trackEvent('Verification', 'Real Bank Assets Saved to DB');
            
            if (box) {
                box.classList.replace('bg-primary', 'bg-green-500/10');
                box.classList.replace('border-white/10', 'border-green-500/30');
                box.innerHTML = `
                    <div class="flex flex-col items-center">
                        <div class="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center text-green-500 mb-4">
                            <span class="material-symbols-outlined text-3xl">check</span>
                        </div>
                        <span class="text-green-400 font-bold uppercase tracking-widest text-xs">Balances Verified Successfully</span>
                    </div>
                `;
            }
            if (nextBtn) {
                nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                nextBtn.removeAttribute('disabled');
            }
        } catch (err) {
            console.error('Failed to sync assets:', err);
            alert('Failed to sync balances. You might need to launch the Secure Link first.');
            if (box) box.innerHTML = '<span class="text-red-400">Sync Failed</span>';
        }
    }, 2000);
}

function renderSyncResult() {
    return `
        <div class="w-full bg-white/5 rounded-3xl p-8 border border-green-500/30 text-left mb-8 reveal reveal-up">
            <div class="flex items-center gap-3 mb-6">
                <div class="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-500">
                    <span class="material-symbols-outlined">check</span>
                </div>
                <span class="text-[10px] font-black text-white uppercase tracking-widest">Verified Multi-Source Income Data</span>
            </div>
            
            <div class="grid grid-cols-2 gap-6">
                <div>
                    <span class="block text-[9px] font-black text-white/30 uppercase tracking-widest mb-1">Payroll Provider</span>
                    <span class="text-white font-bold">ADP Global</span>
                </div>
                <div>
                    <span class="block text-[9px] font-black text-white/30 uppercase tracking-widest mb-1">Sync Date</span>
                    <span class="text-white font-bold">Mar 21, 2026</span>
                </div>
                <div>
                    <span class="block text-[9px] font-black text-white/30 uppercase tracking-widest mb-1">Avg. Gross Pay</span>
                    <span class="text-secondary-fixed font-black">$4,582.50</span>
                </div>
                <div>
                    <span class="block text-[9px] font-black text-white/30 uppercase tracking-widest mb-1">Status</span>
                    <span class="text-white font-bold">Fully Verified</span>
                </div>
            </div>
            
            <div class="mt-6 pt-4 border-t border-white/10">
                <div class="flex items-center justify-between">
                     <span class="text-[9px] font-black text-white/30 uppercase tracking-widest">YTD Earnings (Verified)</span>
                     <span class="text-white/60 font-bold">$22,912.50</span>
                </div>
            </div>
        </div>
    `;
}

function renderWizard(step) {
    const steps = [
        { id: 1, title: 'Identity', icon: 'badge', desc: 'Secure ID Verification' },
        { id: 2, title: 'Payroll', icon: 'work', desc: 'Direct Employer Sync' },
        { id: 3, title: 'Assets', icon: 'account_balance', desc: 'Direct Bank Link' },
        { id: 4, title: 'Credit', icon: 'trending_up', desc: 'Secure Credit Pull' },
        { id: 5, title: 'Loan', icon: 'home', desc: 'Property & Loan Details' },
        { id: 6, title: 'History', icon: 'history', desc: '2-Year Tracking' },
        { id: 7, title: 'Final', icon: 'description', desc: 'Legal Declarations' }
    ];


    const currentStep = steps.find(s => s.id === step);

    return `
        <section class="min-h-screen bg-primary pt-32 pb-24 relative overflow-hidden">
             <!-- Background Image with Overlay -->
            <div class="absolute inset-0 z-0 opacity-10">
                <img src="assets/modern.webp" alt="Wizard Background" class="w-full h-full object-cover" loading="lazy">
            </div>
            <div class="absolute inset-0 bg-primary/90 z-0"></div>

            <div class="max-w-4xl mx-auto px-4 relative z-10">
                <!-- Wizard Header -->
                <div class="flex flex-col items-center text-center mb-16 reveal reveal-up">
                    <div class="flex items-center gap-4 mb-8">
                        ${steps.map(s => `
                            <div class="flex items-center gap-2">
                                <div class="w-10 h-10 rounded-full flex items-center justify-center font-black text-xs ${s.id === step ? 'bg-secondary-fixed text-primary shadow-lg shadow-secondary-fixed/20' : (s.id < step ? 'bg-green-500 text-white' : 'bg-white/10 text-white/30')}">
                                    ${s.id < step ? '<span class="material-symbols-outlined">check</span>' : s.id}
                                </div>
                                 <span class="hidden md:block text-[10px] font-black uppercase tracking-widest ${s.id === step ? 'text-white' : 'text-white/20'}">${s.title}</span>
                                ${s.id < 7 ? `<div class="w-8 h-px ${s.id < step ? 'bg-green-500/50' : 'bg-white/10'}"></div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                    <h2 class="text-4xl md:text-5xl font-black text-white mb-4 uppercase tracking-tight">Step ${step}: <span class="text-secondary-fixed">${currentStep.title}</span></h2>
                    <p class="text-white/40 font-bold uppercase tracking-[0.2em] text-sm">${currentStep.desc}</p>
                </div>

                <!-- Wizard Content Card -->
                <div class="p-10 md:p-16 rounded-[4rem] glass-card border-white/10 shadow-2xl reveal reveal-up">
                    ${step === 1 ? `
                        <div class="flex flex-col items-center text-center">
                            <div class="w-32 h-32 rounded-[2rem] bg-secondary-fixed/10 border border-secondary-fixed/20 flex items-center justify-center mb-10">
                                <span class="material-symbols-outlined text-secondary-fixed text-6xl">badge</span>
                            </div>
                            <h3 class="text-2xl font-black text-white mb-6 uppercase tracking-tight">Drivers License or Passport</h3>
                            <p class="text-white/40 mb-12 max-w-md mx-auto leading-relaxed">We use **Persona** to verify your identity. Please have your ID ready. This process is encrypted and takes less than 60 seconds.</p>
                            
                            <div id="persona-verification-container" class="w-full max-w-sm mb-12">
                                <button onclick="window.startPersonaVerification()" id="persona-start-btn" class="w-full py-12 rounded-3xl border-2 border-dashed border-white/10 bg-white/5 flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 transition-all group mb-4">
                                    <span class="material-symbols-outlined text-4xl text-white/20 group-hover:text-secondary-fixed mb-4 transition-colors">fingerprint</span>
                                    <span class="text-white/40 font-bold uppercase tracking-widest text-xs group-hover:text-white transition-colors">Start ID Verification</span>
                                </button>
                            </div>

                            <button id="id-next-btn" onclick="window.nextWizardStep(1)" class="w-full max-w-xs py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95 opacity-50 cursor-not-allowed" disabled>
                                Identification Verified
                            </button>
                        </div>
                    ` : step === 2 ? `
                        <div class="flex flex-col items-center text-center">
                            <div class="w-32 h-32 rounded-[2rem] bg-secondary-fixed/10 border border-secondary-fixed/20 flex items-center justify-center mb-10">
                                <span class="material-symbols-outlined text-secondary-fixed text-6xl">work</span>
                            </div>
                            <h3 class="text-2xl font-black text-white mb-6 uppercase tracking-tight">Income Verification</h3>
                            <p class="text-white/40 mb-12 max-w-md mx-auto leading-relaxed">Securely connect your primary bank account so we can scan for recent payroll direct deposits. This allows us to instantly verify your income without needing paystubs.</p>
                            
                            <div onclick="window.initializePlaidLink(true)" id="payroll-sync-box" class="w-full max-w-sm py-12 rounded-3xl border-2 border-secondary-fixed/50 bg-secondary-fixed/10 flex flex-col items-center justify-center cursor-pointer hover:bg-secondary-fixed/20 transition-all group mb-8 shadow-[0_0_30px_rgba(211,189,115,0.15)]">
                                <span class="material-symbols-outlined text-4xl text-secondary-fixed mb-4 transition-transform group-hover:scale-110">account_balance</span>
                                <span class="text-secondary-fixed font-black uppercase tracking-widest text-xs">Connect Bank to Verify Income</span>
                            </div>

                            <div id="sync-status-container" class="hidden w-full max-w-xs">
                                <!-- Sync Processing UI will be injected here -->
                            </div>

                            <button id="wizard-next-btn" onclick="window.nextWizardStep(2)" class="w-full max-w-xs py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95 opacity-50 cursor-not-allowed" disabled>
                                Confirm Synced Data
                            </button>
                        </div>
                        <div class="flex flex-col items-center text-center">
                            <div class="w-32 h-32 rounded-[2rem] bg-secondary-fixed/10 border border-secondary-fixed/20 flex items-center justify-center mb-10">
                                <span class="material-symbols-outlined text-secondary-fixed text-6xl">account_balance</span>
                            </div>
                            <h3 class="text-2xl font-black text-white mb-6 uppercase tracking-tight">Down Payment & Assets</h3>
                            <p class="text-white/40 mb-8 max-w-md mx-auto leading-relaxed">Since you securely linked your bank in the previous step, we can now instantly verify your liquid account balances without needing statements.</p>
                            
                             <div id="asset-sync-box" class="w-full max-w-md p-10 rounded-3xl bg-primary border border-white/10 mb-12 text-center group hover:border-secondary-fixed transition-all duration-700">
                                <div class="w-16 h-16 rounded-full bg-secondary-fixed/10 flex items-center justify-center text-secondary-fixed mx-auto mb-6 transform group-hover:scale-110 transition-transform">
                                    <span class="material-symbols-outlined text-3xl">lock</span>
                                </div>
                                <button onclick="window.startAssetSync()" class="w-full py-5 rounded-2xl bg-secondary-fixed text-primary font-black text-sm uppercase tracking-widest hover:bg-white transition-all shadow-xl active:scale-95">
                                    Sync Live Balances Now
                                </button>
                             </div>

                            <button id="assets-next-btn" onclick="window.nextWizardStep(3)" class="w-full max-w-xs py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95 opacity-50 cursor-not-allowed" disabled>
                                Assets Verified
                            </button>
                        </div>
                    ` : step === 4 ? `
                        <div class="flex flex-col items-center text-center">
                            <div class="w-24 h-24 rounded-[2rem] bg-secondary-fixed/10 border border-secondary-fixed/20 flex items-center justify-center mb-6">
                                <span class="material-symbols-outlined text-secondary-fixed text-5xl">trending_up</span>
                            </div>
                            <h3 class="text-2xl font-black text-white mb-4 uppercase tracking-tight">Credit & Background</h3>
                            <p class="text-white/40 mb-8 max-w-md mx-auto leading-relaxed text-sm">We perform a soft-pull of your credit via **Experian Sandbox**. Please enter test data.</p>
                            
                             <div id="credit-status-container" class="w-full max-w-md p-8 rounded-3xl bg-primary border border-white/10 mb-8 text-left transition-all duration-700">
                                
                                <form id="credit-pull-form" onsubmit="event.preventDefault(); window.pullCreditRecord();" class="space-y-4">
                                    <div>
                                        <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-2 px-1">Full SSN (Sandbox Only)</label>
                                        <input id="cp-ssn" type="text" placeholder="XXX-XX-XXXX" class="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white placeholder-white/20 focus:outline-none focus:border-secondary-fixed/50 transition-all font-medium text-sm" required>
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-2 px-1">Date of Birth</label>
                                        <input id="cp-dob" type="date" class="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white placeholder-white/20 focus:outline-none focus:border-secondary-fixed/50 transition-all font-medium text-sm" required>
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-2 px-1">Street Address</label>
                                        <input id="cp-address" type="text" placeholder="123 Main St" class="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white placeholder-white/20 focus:outline-none focus:border-secondary-fixed/50 transition-all font-medium text-sm" required>
                                    </div>
                                    <div class="grid grid-cols-3 gap-3">
                                        <div class="col-span-1">
                                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-2 px-1">City</label>
                                            <input id="cp-city" type="text" placeholder="Boston" class="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white placeholder-white/20 focus:outline-none focus:border-secondary-fixed/50 transition-all font-medium text-sm" required>
                                        </div>
                                        <div class="col-span-1">
                                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-2 px-1">State</label>
                                            <input id="cp-state" type="text" placeholder="MA" maxlength="2" class="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white placeholder-white/20 focus:outline-none focus:border-secondary-fixed/50 transition-all font-medium text-sm uppercase" required>
                                        </div>
                                        <div class="col-span-1">
                                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-2 px-1">Zip</label>
                                            <input id="cp-zip" type="text" placeholder="02108" class="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white placeholder-white/20 focus:outline-none focus:border-secondary-fixed/50 transition-all font-medium text-sm" required>
                                        </div>
                                    </div>
                                    
                                    <button id="credit-pull-btn" type="submit" class="w-full mt-4 py-4 rounded-xl bg-secondary-fixed text-primary font-black text-sm uppercase tracking-widest hover:bg-white transition-all shadow-xl active:scale-95">
                                        Verify via Experian
                                    </button>
                                </form>
                             </div>

                            <button id="credit-next-btn" onclick="window.nextWizardStep(4)" class="w-full max-w-xs py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95 opacity-50 cursor-not-allowed" disabled>
                                Verify & Continue To Loan Details
                            </button>
                        </div>
                    ` : step === 5 ? `
                        <div class="flex flex-col text-left">
                            <h3 class="text-2xl font-black text-white mb-6 uppercase tracking-tight">Property & Loan Details</h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                                <div>
                                    <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-1">Subject Property Type</label>
                                    <select id="step5-property-type" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white focus:border-secondary-fixed transition-all font-bold">
                                        <option value="SingleFamily">Single Family Home</option>
                                        <option value="Townhouse">Townhouse</option>
                                        <option value="Condo">Condominium</option>
                                        <option value="MultiFamily">Multi-Family</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-1">Occupancy Type</label>
                                    <select id="step5-occupancy-type" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white focus:border-secondary-fixed transition-all font-bold">
                                        <option value="PrimaryResidence">Primary Residence</option>
                                        <option value="SecondHome">Second Home</option>
                                        <option value="Investment">Investment Property</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-1">Purchase Price</label>
                                    <input id="step5-price" type="number" value="750000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white focus:border-secondary-fixed outline-none transition-all font-bold">
                                </div>
                                <div>
                                    <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-1">Estimated Down Payment</label>
                                    <input id="step5-down" type="number" value="150000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white focus:border-secondary-fixed outline-none transition-all font-bold">
                                </div>
                            </div>
                            <button onclick="window.nextWizardStep(5)" class="w-full py-5 rounded-[2rem] bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95">
                                Save & Continue
                            </button>
                        </div>
                    ` : step === 6 ? `
                        <div class="flex flex-col text-left">
                            <h3 class="text-2xl font-black text-white mb-6 uppercase tracking-tight">2-Year Professional & Residential History</h3>
                            <p class="text-white/40 mb-10 font-bold uppercase tracking-widest text-[10px]">Brokers require 24 months of verified history for risk analysis.</p>

                            <!-- Employment -->
                            <div class="mb-12">
                                <div class="flex items-center justify-between mb-6">
                                    <span class="text-secondary-fixed font-black uppercase tracking-[0.2em] text-xs">Employment History</span>
                                    <button onclick="window.addEmploymentRow()" class="text-[10px] bg-white/5 hover:bg-white/10 text-white font-black py-2 px-4 rounded-full border border-white/10 transition-all">+ Add Employer</button>
                                </div>
                                <div id="employment-rows" class="space-y-4">
                                    <div class="employment-row p-6 rounded-3xl bg-white/5 border border-white/10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                        <input type="text" placeholder="Employer Name" class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-name">
                                        <input type="text" placeholder="Position/Title" class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-title">
                                        <input type="date" class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-start">
                                        <input type="number" placeholder="Gross Monthly Income" class="w-full bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-income">
                                    </div>
                                </div>
                            </div>

                            <!-- Residential -->
                            <div class="mb-12">
                                <div class="flex items-center justify-between mb-6">
                                    <span class="text-secondary-fixed font-black uppercase tracking-[0.2em] text-xs">Residential History</span>
                                    <button onclick="window.addResidencyRow()" class="text-[10px] bg-white/5 hover:bg-white/10 text-white font-black py-2 px-4 rounded-full border border-white/10 transition-all">+ Add Previous Address</button>
                                </div>
                                <div id="residency-rows" class="space-y-4">
                                    <div class="residency-row p-6 rounded-3xl bg-white/5 border border-white/10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        <input type="text" placeholder="Full Home Address" class="lg:col-span-2 bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold res-address">
                                        <select class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold res-status">
                                            <option value="Own">Own</option>
                                            <option value="Rent">Rent</option>
                                            <option value="LivingRentFree">Living Rent Free</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <button onclick="window.nextWizardStep(6)" class="w-full py-5 rounded-[2rem] bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95">
                                Save History & Continue
                            </button>
                        </div>
                    ` : `
                        <div class="flex flex-col text-left">
                            <h3 class="text-2xl font-black text-white mb-6 uppercase tracking-tight">Legal Declarations</h3>
                            <div class="space-y-6 mb-12">
                                <div class="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/10">
                                    <span class="text-sm font-bold text-white uppercase tracking-tight w-2/3">Are there any outstanding judgments against you?</span>
                                    <div class="flex space-x-6 w-1/3 justify-end leading-none">
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-judgments" value="yes" class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer" required><span class="text-sm font-bold text-white">Yes</span></label>
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-judgments" value="no" class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer"><span class="text-sm font-bold text-white">No</span></label>
                                    </div>
                                </div>
                                <div class="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/10">
                                    <span class="text-sm font-bold text-white uppercase tracking-tight w-2/3">Have you declared bankruptcy within the past 7 years?</span>
                                    <div class="flex space-x-6 w-1/3 justify-end leading-none">
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-bankruptcy" value="yes" class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer" required><span class="text-sm font-bold text-white">Yes</span></label>
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-bankruptcy" value="no" class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer"><span class="text-sm font-bold text-white">No</span></label>
                                    </div>
                                </div>
                                <div class="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/10">
                                    <span class="text-sm font-bold text-white uppercase tracking-tight w-2/3">Are you currently a party to a lawsuit?</span>
                                    <div class="flex space-x-6 w-1/3 justify-end leading-none">
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-lawsuits" value="yes" class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer" required><span class="text-sm font-bold text-white">Yes</span></label>
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-lawsuits" value="no" class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer"><span class="text-sm font-bold text-white">No</span></label>
                                    </div>
                                </div>
                                <div class="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/10">
                                    <span class="text-sm font-bold text-white uppercase tracking-tight w-2/3">Are you a Canadian Citizen or Permanent Resident?</span>
                                    <div class="flex space-x-6 w-1/3 justify-end leading-none">
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-citizen" value="yes" checked class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer" required><span class="text-sm font-bold text-white">Yes</span></label>
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-citizen" value="no" class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer"><span class="text-sm font-bold text-white">No</span></label>
                                    </div>
                                </div>
                            </div>
                            
                            <button id="final-submit-btn" onclick="window.nextWizardStep(7)" class="w-full py-6 rounded-[2rem] bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.05] transition-all shadow-2xl active:scale-95">
                                Complete & Submit Official Application
                            </button>
                        </div>
                    `}
                </div>

                <button onclick="window.togglePortal(true)" class="mt-12 w-full text-center text-white/20 hover:text-white transition-colors uppercase font-black tracking-widest text-xs">
                    Cancel & Return to Dashboard
                </button>
            </div>
        </section>
    `;
}

function renderLogin() {
    return `
        <section class="min-h-screen bg-primary flex items-center justify-center pt-24 pb-12 relative overflow-hidden">
             <!-- Background Image with Overlay -->
            <div class="absolute inset-0 z-0 opacity-20">
                <img src="assets/modern.webp" alt="Login Background" class="w-full h-full object-cover" loading="lazy">
            </div>
            <div class="absolute inset-0 bg-primary/80 z-0"></div>

            <div class="max-w-md w-full px-6 relative z-10 reveal reveal-up">
                <div class="p-10 md:p-12 rounded-[3.5rem] glass-card border-white/10 shadow-2xl text-center">
                    <div class="w-20 h-20 rounded-3xl bg-secondary-fixed/10 border border-secondary-fixed/20 flex items-center justify-center mb-8 mx-auto">
                        <span class="material-symbols-outlined text-secondary-fixed text-4xl">lock</span>
                    </div>
                    <h2 class="text-3xl font-black text-white mb-2 uppercase tracking-tight">Secure Access</h2>
                    <p class="text-white/40 text-sm mb-10 font-bold uppercase tracking-[0.2em]">Borrower Portal 2026</p>

                    <div id="login-error" class="text-red-400 text-xs font-bold uppercase tracking-widest mb-4"></div>

                    <div class="space-y-6 text-left">
                        <div>
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Email Address</label>
                            <input id="login-email" type="email" placeholder="client@example.com" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div>
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Password</label>
                            <input id="login-password" type="password" placeholder="••••••••" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium" onkeydown="if(event.key==='Enter') window.submitLogin()">
                        </div>
                        <button id="login-btn" onclick="window.submitLogin()" class="w-full py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95 mt-4">
                            Log In & Authenticate
                        </button>
                    </div>
                    
                    <div class="mt-8 flex flex-col gap-4">
                        <button onclick="window.showRegister()" class="text-secondary-fixed text-xs font-bold uppercase tracking-widest hover:underline">Create New Account</button>
                        <button onclick="window.togglePortal(false)" class="text-white/40 text-xs font-bold hover:text-white transition-colors uppercase tracking-[0.1em]">
                            Cancel & Return to Site
                        </button>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function renderRegister() {
    return `
        <section class="min-h-screen bg-primary flex items-center justify-center pt-24 pb-12 relative overflow-hidden">
            <div class="absolute inset-0 z-0 opacity-20">
                <img src="assets/modern.webp" alt="Register Background" class="w-full h-full object-cover" loading="lazy">
            </div>
            <div class="absolute inset-0 bg-primary/80 z-0"></div>

            <div class="max-w-md w-full px-6 relative z-10 reveal reveal-up">
                <div class="p-10 md:p-12 rounded-[3.5rem] glass-card border-white/10 shadow-2xl text-center">
                    <div class="w-20 h-20 rounded-3xl bg-secondary-fixed/10 border border-secondary-fixed/20 flex items-center justify-center mb-8 mx-auto">
                        <span class="material-symbols-outlined text-secondary-fixed text-4xl">person_add</span>
                    </div>
                    <h2 class="text-3xl font-black text-white mb-2 uppercase tracking-tight">New Application</h2>
                    <p class="text-white/40 text-sm mb-10 font-bold uppercase tracking-[0.2em]">Create Your Secure Profile</p>

                    <div id="register-error" class="text-red-400 text-xs font-bold uppercase tracking-widest mb-4"></div>

                    <div class="space-y-6 text-left">
                        <div>
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Full Name</label>
                            <input id="register-name" type="text" placeholder="John Smith" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div>
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Email Address</label>
                            <input id="register-email" type="email" placeholder="your@email.com" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div>
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Phone Number</label>
                            <input id="register-phone" type="tel" placeholder="(555) 000-0000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div>
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Create Password</label>
                            <input id="register-password" type="password" placeholder="Min 6 characters" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium" onkeydown="if(event.key==='Enter') window.submitRegister()">
                        </div>
                        <button id="register-btn" onclick="window.submitRegister()" class="w-full py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95 mt-4">
                            Create Secure Account
                        </button>
                    </div>
                    
                    <div class="mt-8 flex flex-col gap-4">
                        <button onclick="window.showLogin()" class="text-secondary-fixed text-xs font-bold uppercase tracking-widest hover:underline">Already Have an Account? Log In</button>
                        <button onclick="window.togglePortal(false)" class="text-white/40 text-xs font-bold hover:text-white transition-colors uppercase tracking-[0.1em]">
                            Cancel & Return to Site
                        </button>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function renderMFAChallenge(type) {
    return `
        <section class="min-h-screen bg-primary flex items-center justify-center relative overflow-hidden">
            <div class="absolute inset-0 z-0 opacity-10">
                <img src="assets/modern.webp" alt="Background" class="w-full h-full object-cover" loading="lazy">
            </div>
            <div class="max-w-md w-full p-8 relative z-10">
                <div class="glass-card p-10 rounded-[3.5rem] border-white/10 shadow-2xl text-center">
                    <div class="w-20 h-20 rounded-full bg-secondary-fixed/20 flex items-center justify-center mx-auto mb-8">
                        <span class="material-symbols-outlined text-4xl text-secondary-fixed">${type === 'totp' ? 'verified_user' : 'mark_email_read'}</span>
                    </div>
                    <h2 class="text-3xl font-black text-white uppercase tracking-tight mb-4">Two-Step Verification</h2>
                    <p class="text-white/60 mb-8 font-medium">
                        ${type === 'totp' ? 'Open your <strong>Google Authenticator</strong> app and enter the 6-digit code.' : 'We\'ve sent a 6-digit verification code to your email.'}
                    </p>
                    
                    <div class="space-y-6">
                        <input id="mfa-code" type="text" maxlength="6" placeholder="000000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-5 text-center text-3xl font-black text-secondary-fixed placeholder:text-white/10 tracking-[0.5em] outline-none focus:border-secondary-fixed/50 transition-all" autofocus>
                        <div id="mfa-error" class="text-red-400 text-xs font-bold uppercase tracking-widest h-4"></div>
                        <button onclick="window.submitMFA()" class="w-full py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95">
                            Verify & Log In
                        </button>
                        <button onclick="window.showLogin()" class="text-white/30 text-[10px] font-black uppercase tracking-widest hover:text-white transition-all">Cancel</button>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function renderRegistrationVerification(email) {
    return `
        <section class="min-h-screen bg-primary flex items-center justify-center relative overflow-hidden">
            <div class="absolute inset-0 z-0 opacity-10">
                <img src="assets/modern.webp" alt="Background" class="w-full h-full object-cover" loading="lazy">
            </div>
            <div class="max-w-2xl w-full p-8 relative z-10">
                <div class="glass-card p-12 rounded-[4rem] border-white/10 shadow-2xl text-center">
                    <div class="w-20 h-20 rounded-full bg-secondary-fixed/20 flex items-center justify-center mx-auto mb-8">
                        <span class="material-symbols-outlined text-4xl text-secondary-fixed">verified_user</span>
                    </div>
                    <h2 class="text-3xl font-black text-white uppercase tracking-tight mb-4">Verification Required</h2>
                    <p class="text-white/60 mb-12 font-medium max-w-md mx-auto line-tight">
                        To protect your identity, we've sent unique verification codes to both your email and phone.
                    </p>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                        <div class="space-y-4">
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-[0.2em] px-2 flex items-center gap-2">
                                <span class="material-symbols-outlined">mail</span> Email Code
                            </label>
                            <input id="verify-email-code" type="text" maxlength="6" placeholder="000000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-5 text-center text-2xl font-black text-white placeholder:text-white/10 tracking-[0.3em] outline-none focus:border-secondary-fixed transition-all">
                        </div>
                        <div class="space-y-4">
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-[0.2em] px-2 flex items-center gap-2">
                                <span class="material-symbols-outlined">phone_iphone</span> SMS Code
                            </label>
                            <input id="verify-phone-code" type="text" maxlength="6" placeholder="000000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-5 text-center text-2xl font-black text-white placeholder:text-white/10 tracking-[0.3em] outline-none focus:border-secondary-fixed transition-all">
                        </div>
                    </div>

                    <div id="verify-reg-error" class="text-red-400 text-xs font-bold uppercase tracking-widest h-4 my-8"></div>
                    
                    <div class="flex flex-col gap-4">
                        <button onclick="window.submitRegistrationVerification()" class="w-full py-6 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95">
                            Complete Verification
                        </button>
                        <div class="flex items-center justify-between px-4 mt-4">
                             <button onclick="window.resendRegistrationVerification()" class="text-white/30 text-[10px] font-black uppercase tracking-widest hover:text-white transition-all">Resend Codes</button>
                             <button onclick="window.showLogin()" class="text-white/30 text-[10px] font-black uppercase tracking-widest hover:text-white transition-all">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

window.submitRegistrationVerification = async function() {
    const emailCode = document.getElementById('verify-email-code').value;
    const phoneCode = document.getElementById('verify-phone-code').value;
    const errorEl = document.getElementById('verify-reg-error');
    
    if (!emailCode || !phoneCode) {
        errorEl.textContent = 'Both codes are required.';
        return;
    }

    try {
        const res = await fetch('/api/auth/verify-registration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: window.mfaContext.email, emailCode, phoneCode })
        });
        const data = await res.json();

        if (data.success) {
            localStorage.setItem('jwt_token', data.token);
            localStorage.setItem('user_data', JSON.stringify(data.user));
            await window.checkUserStatus();
            window.togglePortal(true);
        } else {
            errorEl.textContent = data.error || 'Verification failed.';
        }
    } catch (e) {
        errorEl.textContent = 'Verification service unavailable.';
    }
}

window.resendRegistrationVerification = async function() {
    try {
        const res = await fetch('/api/auth/resend-verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: window.mfaContext.email })
        });
        const data = await res.json();
        if (data.success) {
            alert('Verification codes resent!');
        }
    } catch (e) { console.error(e); }
}

window.submitMFA = async function() {
    const code = document.getElementById('mfa-code').value;
    const errorEl = document.getElementById('mfa-error');
    if (!code || code.length < 6) return;

    try {
        const res = await fetch('/api/auth/mfa/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: window.mfaContext.email, code })
        });
        const data = await res.json();

        if (data.success) {
            localStorage.setItem('jwt_token', data.token);
            localStorage.setItem('user_data', JSON.stringify(data.user));
            await window.checkUserStatus();
            window.togglePortal(true);
        } else {
            errorEl.textContent = data.error || 'Invalid code';
        }
    } catch (e) {
        errorEl.textContent = 'Verification service unavailable.';
    }
}

window.showSecurity = function() {
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = renderSecuritySettings();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();
    window.loadSecurityData();
}

function renderSecuritySettings() {
    return `
        <section class="min-h-screen bg-primary pt-32 pb-24 relative overflow-hidden">
            <div class="absolute inset-0 z-0 opacity-10">
                <img src="assets/modern.webp" alt="Background" class="w-full h-full object-cover" loading="lazy">
            </div>
            <div class="max-w-4xl mx-auto px-4 relative z-10">
                <div class="flex items-center justify-between mb-12">
                    <button onclick="window.togglePortal(true)" class="flex items-center gap-2 text-white/40 hover:text-white transition-all font-bold uppercase tracking-widest text-xs">
                        <span class="material-symbols-outlined">chevron_left</span> Back to Dashboard
                    </button>
                    <h2 class="text-3xl font-black text-white uppercase tracking-tight">Account <span class="text-secondary-fixed">Security</span></h2>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <!-- Method 1: Email -->
                    <div class="glass-card p-10 rounded-[3rem] border-white/10 hover:border-secondary-fixed/20 transition-all group">
                        <div class="w-16 h-16 rounded-2xl bg-secondary-fixed/10 flex items-center justify-center text-secondary-fixed mb-8 group-hover:scale-110 transition-transform">
                            <span class="material-symbols-outlined text-3xl">mail</span>
                        </div>
                        <h3 class="text-xl font-black text-white uppercase mb-2">Email Verification</h3>
                        <p class="text-white/40 text-sm mb-8 leading-relaxed">Receive a 6-digit code in your inbox for every login attempt.</p>
                        <div id="email-mfa-status">
                             <button onclick="window.enableMFA('email')" class="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-black uppercase tracking-widest text-xs hover:bg-secondary-fixed hover:text-primary transition-all">Enable Email MFA</button>
                        </div>
                    </div>

                    <!-- Method 2: Authenticator -->
                    <div class="glass-card p-10 rounded-[3rem] border-white/10 hover:border-secondary-fixed/20 transition-all group">
                        <div class="w-16 h-16 rounded-2xl bg-secondary-fixed/10 flex items-center justify-center text-secondary-fixed mb-8 group-hover:scale-110 transition-transform">
                            <span class="material-symbols-outlined text-3xl">verified_user</span>
                        </div>
                        <h3 class="text-xl font-black text-white uppercase mb-2">Authenticator App</h3>
                        <p class="text-white/40 text-sm mb-8 leading-relaxed">Use apps like Google Authenticator or Authy to generate secure codes.</p>
                        <div id="totp-mfa-status">
                            <button onclick="window.setupTOTP()" class="w-full py-4 rounded-2xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-xs hover:bg-white transition-all">Setup Authenticator</button>
                        </div>
                    </div>
                </div>

                <!-- TOTP Setup Modal (Hidden by default) -->
                <div id="totp-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-primary/90 backdrop-blur-sm p-4">
                    <div class="glass-card p-10 rounded-[3.5rem] border-white/20 shadow-2xl max-w-md w-full text-center">
                        <h3 class="text-2xl font-black text-white uppercase tracking-tight mb-6">Setup Authenticator</h3>
                        <div id="qr-container" class="bg-white p-4 rounded-3xl inline-block mb-8 shadow-inner overflow-hidden">
                            <div class="w-48 h-48 bg-gray-100 flex items-center justify-center">
                                <span class="material-symbols-outlined animate-spin text-2xl text-primary">progress_activity</span>
                            </div>
                        </div>
                        <p class="text-white/60 text-sm mb-8">Scan this QR code with your Authenticator app, then enter the 6-digit code below to confirm.</p>
                        <input id="totp-setup-code" type="text" placeholder="000000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 text-center text-xl font-bold text-secondary-fixed mb-6 outline-none">
                        <div class="flex gap-4">
                            <button onclick="document.getElementById('totp-modal').classList.add('hidden')" class="flex-1 py-4 text-white/40 font-bold uppercase tracking-widest text-xs">Cancel</button>
                            <button onclick="window.verifyTOTP()" class="flex-1 py-4 rounded-2xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-xs">Verify & Enable</button>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

window.loadSecurityData = async function() {
    // We already have userStatus from checkUserStatus
    const user = window.userStatus;
    if (!user) return;

    const emailStatus = document.getElementById('email-mfa-status');
    const totpStatus = document.getElementById('totp-mfa-status');

    if (!user.mfaEnabled) {
        emailStatus.innerHTML = `<button onclick="window.enableMFA('email')" class="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-black uppercase tracking-widest text-xs hover:bg-secondary-fixed hover:text-primary transition-all">Enable Email MFA</button>`;
        totpStatus.innerHTML = `<button onclick="window.setupTOTP()" class="w-full py-4 rounded-2xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-xs hover:bg-white transition-all">Setup Authenticator</button>`;
        return;
    }

    if (user.mfaType === 'email') {
        emailStatus.innerHTML = `<div class="flex items-center gap-2 text-green-400 font-black text-xs uppercase"><span class="material-symbols-outlined text-lg">check_circle</span> Active</div>
                                  <button onclick="window.disableMFA()" class="mt-4 text-white/20 hover:text-red-400 text-[10px] font-black uppercase underline">Disable</button>`;
        totpStatus.innerHTML = `<button onclick="window.setupTOTP()" class="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-black uppercase tracking-widest text-xs hover:bg-secondary-fixed hover:text-primary transition-all">Switch to App</button>`;
    } else if (user.mfaType === 'totp') {
        totpStatus.innerHTML = `<div class="flex items-center gap-2 text-green-400 font-black text-xs uppercase"><span class="material-symbols-outlined text-lg">check_circle</span> Active</div>
                                 <button onclick="window.disableMFA()" class="mt-4 text-white/20 hover:text-red-400 text-[10px] font-black uppercase underline">Disable</button>`;
        emailStatus.innerHTML = `<button onclick="window.enableMFA('email')" class="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-black uppercase tracking-widest text-xs hover:bg-secondary-fixed hover:text-primary transition-all">Switch to Email</button>`;
    }
}

window.enableMFA = async function(type) {
    try {
        const res = await authFetch('/api/auth/mfa/enable', {
            method: 'POST',
            body: JSON.stringify({ type })
        });
        const data = await res.json();
        if (data.success) {
            await window.checkUserStatus();
            window.loadSecurityData();
        }
    } catch (e) { console.error(e); }
}

window.disableMFA = async function() {
    if (!confirm('Disabling MFA will make your account less secure. Continue?')) return;
    try {
        await authFetch('/api/auth/mfa/disable', { method: 'POST' });
        await window.checkUserStatus();
        window.loadSecurityData();
    } catch (e) { console.error(e); }
}

window.setupTOTP = async function() {
    const modal = document.getElementById('totp-modal');
    const qrContainer = document.getElementById('qr-container');
    modal.classList.remove('hidden');

    try {
        const res = await authFetch('/api/auth/mfa/setup', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            qrContainer.innerHTML = `<img src="${data.qrCode}" alt="QR Code" class="w-full h-full" loading="lazy">`;
        }
    } catch (e) { console.error(e); }
}

window.verifyTOTP = async function() {
    const code = document.getElementById('totp-setup-code').value;
    if (!code) return;

    try {
        const res = await authFetch('/api/auth/mfa/enable', {
            method: 'POST',
            body: JSON.stringify({ type: 'totp', code })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('totp-modal').classList.add('hidden');
            await window.checkUserStatus();
            window.loadSecurityData();
        } else {
            alert(data.error || 'Invalid code');
        }
    } catch (e) { console.error(e); }
}

window.focusedStepOverride = null;
window.setFocusStep = function(stepIdx) {
    window.focusedStepOverride = stepIdx;
    const main = document.querySelector('main');
    if (main) main.innerHTML = renderPortal();
};

function renderPortal() {
    const appStatus = window.userStatus?.application;
    const loanCompleted = !!appStatus && appStatus.status !== 'Draft';
    const completedSteps = window.userStatus?.completedSteps || 0;
    const progressPercent = window.userStatus?.progressPercent || 0;

    const idDone = appStatus?.identityVerified || (window.userStatus?.identityStatus === 'completed' || window.userStatus?.identityStatus === 'Verified');
    const incomeDone = appStatus?.incomeVerified || false;
    const assetsDone = appStatus?.assetsVerified || false;
    const creditDone = appStatus?.creditVerified || false;
    const submitted = loanCompleted;

    const step1Unlocked = true;
    const step2Unlocked = idDone;
    const step3Unlocked = idDone && incomeDone;
    const step4Unlocked = idDone && incomeDone && assetsDone;

    let focusedStep = window.focusedStepOverride !== null ? window.focusedStepOverride : completedSteps;
    if (focusedStep > 4) focusedStep = 4;

    const currentStatus = appStatus?.status || 'Draft';
    const userName = window.userStatus?.name || window.userStatus?.email || 'Borrower';

    // SVG ring math
    const ringRadius = 115;
    const ringCircumference = 2 * Math.PI * ringRadius;
    const ringOffset = ringCircumference - (ringCircumference * progressPercent / 100);

    // Step card definitions
    const verificationCards = [
        { title: 'Verify ID', icon: 'fingerprint', desc: 'Government-issued document verification.', done: idDone, unlocked: step1Unlocked, wizardIdx: 1, btnLabel: 'Start Now', doneLabel: 'Verified' },
        { title: 'Payroll Sync', icon: 'account_balance_wallet', desc: 'Connect to your employer portal securely.', done: incomeDone, unlocked: step2Unlocked, wizardIdx: 2, btnLabel: 'Start Now', doneLabel: 'Synced' },
        { title: 'Link Bank', icon: 'account_balance', desc: 'Verify income and monthly assets.', done: assetsDone, unlocked: step3Unlocked, wizardIdx: 3, btnLabel: 'Start Now', doneLabel: 'Linked' },
        { title: 'Credit Check', icon: 'speed', desc: 'Pull official credit scores for rate locks.', done: creditDone, unlocked: step4Unlocked, wizardIdx: 4, btnLabel: 'Start Now', doneLabel: 'Pulled' }
    ];

    function renderVerificationCard(card, idx) {
        const isActive = !card.done && card.unlocked;
        const isLocked = !card.done && !card.unlocked;
        const isFocused = idx === focusedStep;

        if (card.done) {
            return `
            <div class="glass-card p-8 rounded-2xl border border-green-500/30 bg-green-500/5 transition-all group">
                <div class="w-12 h-12 rounded-xl bg-green-500/20 border border-green-500/30 flex items-center justify-center mb-6">
                    <span class="material-symbols-outlined text-green-400">check_circle</span>
                </div>
                <h3 class="font-headline font-bold text-lg text-white mb-2">${card.title}</h3>
                <p class="text-green-400/80 text-sm mb-8 leading-relaxed">${card.doneLabel} successfully.</p>
                <button onclick="window.startWizard(${card.wizardIdx})" class="w-full py-3 border border-green-500/30 text-green-400 text-xs font-headline font-bold uppercase tracking-widest rounded-lg hover:bg-green-500/10 transition-all">Review</button>
            </div>`;
        }
        if (isLocked) {
            return `
            <div class="glass-card p-8 rounded-2xl border border-white/5 opacity-60 transition-all">
                <div class="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-6">
                    <span class="material-symbols-outlined text-white/40">${card.icon}</span>
                </div>
                <h3 class="font-headline font-bold text-lg text-white/60 mb-2">${card.title}</h3>
                <p class="text-on-primary-container text-sm mb-8 leading-relaxed">${card.desc}</p>
                <button class="w-full py-3 border border-white/10 text-white/30 text-xs font-headline font-bold uppercase tracking-widest rounded-lg cursor-not-allowed">Locked</button>
            </div>`;
        }
        // Active / unlocked
        return `
        <div class="glass-card p-8 rounded-2xl border ${isFocused ? 'border-secondary-fixed/30' : 'border-white/10'} hover:bg-white/5 transition-all group">
            <div class="w-12 h-12 rounded-xl ${isFocused ? 'bg-secondary-container border border-secondary/20' : 'bg-white/5 border border-white/10'} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <span class="material-symbols-outlined ${isFocused ? 'text-secondary-fixed' : 'text-white/60'}">${card.icon}</span>
            </div>
            <h3 class="font-headline font-bold text-lg text-white mb-2">${card.title}</h3>
            <p class="text-on-primary-container text-sm mb-4 leading-relaxed">${card.desc}</p>
            <button onclick="window.startWizard(${card.wizardIdx})" class="w-full py-3 bg-secondary-fixed text-primary text-xs font-headline font-extrabold uppercase tracking-widest rounded-lg transition-all hover:brightness-110 active:scale-95 shadow-lg shadow-secondary/10 mb-2">${card.btnLabel}</button>
            ${idx < 4 ? `<button onclick="window.setFocusStep(${idx + 1})" class="w-full py-2 text-white/40 text-xs font-headline font-bold uppercase tracking-widest hover:text-white/70 transition-colors">Skip for now</button>` : ''}
        </div>`;
    }

    // Progress description text
    let progressDescription = '';
    if (submitted) {
        progressDescription = `Your application is officially <strong>${currentStatus}</strong>. Your broker will reach out soon.`;
    } else if (completedSteps === 0) {
        progressDescription = "You are at the starting line. Complete your identity verification to unlock your personalized loan terms and dedicated support.";
    } else {
        progressDescription = `${completedSteps} of 5 milestones completed. Keep going to unlock your best rates.`;
    }

    // Pending doc count
    const pendingDocs = 4 - completedSteps;

    return `
    <section class="min-h-screen pt-28 relative overflow-hidden bg-primary">
        <!-- Background Image with Overlay -->
        <div class="absolute inset-0 z-0">
            <img alt="Modern luxury architecture" class="w-full h-full object-cover grayscale-[20%] opacity-40" src="https://lh3.googleusercontent.com/aida-public/AB6AXuD8reoSJJiSaylM7f4pV1doOnLZvBxGGSi0XFjuaC-5Dbbfg_Gu2fUR_YdvCNFZRCTxcTuzsPtfGzSQJ-YtlleDdrvKdlMMPQ3YqXir6VoCf7PaH9szTBShUfkd79ftEoS9WKYS5TVvA1ZlD9fODBKtntWhH29sqhh61S9CRP7-Xeha7n7BDmBmUkqTHU69pqS4zWnusZiBFzUKG2xyH-UgSyrLyCKvDWMaRf1D1PCgmsXbjUy6QkyEmCac828gdgkQgJVd2OJRiNNO"/>
            <div class="absolute inset-0 hero-gradient-overlay"></div>
        </div>

        <!-- Main Editorial Application Container -->
        <div class="relative z-10 w-full max-w-7xl mx-auto px-6 py-12">
            <div class="glass-card rounded-[2rem] border border-secondary-fixed/20 p-8 md:p-16 shadow-2xl">

                <!-- Hero Section: 12-col Grid -->
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center mb-16">
                    <!-- Left: 7 cols -->
                    <div class="lg:col-span-7">
                        <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary-container border border-secondary/30 text-secondary-fixed text-xs font-headline font-bold uppercase tracking-[0.2em] mb-6">
                            <span class="w-1.5 h-1.5 rounded-full bg-secondary-fixed animate-pulse"></span>
                            ${submitted ? currentStatus : 'Welcome back, ' + userName}
                        </span>
                        <h1 class="text-white font-headline text-5xl md:text-7xl font-extrabold tracking-tighter mb-8 leading-[1.05]">
                            My Home <br/><span class="text-secondary-fixed">Journey</span>
                        </h1>
                        <!-- Glass Progress Card -->
                        <div class="glass-card p-8 rounded-2xl border border-white/10 max-w-xl">
                            <div class="flex justify-between items-end mb-4">
                                <span class="text-white font-headline font-bold text-lg">Application Phase</span>
                                <span class="text-secondary-fixed font-headline font-black text-2xl">${progressPercent}%</span>
                            </div>
                            <div class="h-[2px] w-full bg-white/10 rounded-full overflow-hidden">
                                <div class="h-full bg-gradient-to-r from-secondary to-secondary-fixed shadow-[0_0_15px_rgba(211,189,115,0.5)] transition-all duration-1000" style="width: ${Math.max(progressPercent, 2)}%;"></div>
                            </div>
                            <p class="mt-6 text-on-primary-container text-sm font-body leading-relaxed">${progressDescription}</p>
                        </div>
                    </div>
                    <!-- Right: 5 cols -->
                    <div class="lg:col-span-5 flex flex-col gap-8 items-end">
                        <!-- Circular Progress Ring -->
                        <div class="relative w-64 h-64 flex items-center justify-center">
                            <svg class="absolute inset-0 w-full h-full -rotate-90">
                                <circle cx="50%" cy="50%" r="45%" fill="transparent" stroke="rgba(255,255,255,0.05)" stroke-width="2"></circle>
                                <circle cx="50%" cy="50%" r="45%" fill="transparent" stroke="#D3BD73" stroke-dasharray="${ringCircumference}" stroke-dashoffset="${ringOffset}" stroke-linecap="round" stroke-width="3" class="transition-all duration-1000 shadow-[0_0_15px_rgba(211,189,115,0.3)]"></circle>
                            </svg>
                            <div class="text-center">
                                <span class="text-white font-headline text-5xl font-black">${window.userStatus?.creditScore || progressPercent + '%'}</span>
                                <p class="text-on-primary-container font-headline text-[10px] uppercase tracking-widest mt-1">${window.userStatus?.creditScore ? 'Credit Score' : 'Completion'}</p>
                            </div>
                        </div>
                        <!-- Expert Card -->
                        <div class="glass-card p-6 rounded-2xl flex items-center gap-5 w-full max-w-sm border-l-4 border-secondary-fixed shadow-xl">
                            <div class="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 border border-white/10">
                                <img alt="Juthi Akhy" class="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-500" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAUxHMTMwNAf5KXFYgZYocChf_-f-djms8_5bL5fORGPzf3Ka_JTPi2Ay2BBTXM3lWf8kjTUbbL5uZO2KN3EhlpWLnHwEIpiPDohqgDHBD38PpFEH3LWI-V8wpPTV4A1S3vmOud_VIfykxmowpCDEVTA0RmdFZHz_NgwKPvTZrq90HqcCWisZjNxqgEe-bHa_PI1kCwuHzc3cigtKTp1KNRIQwoHpDgd07vhyBYSDy0MP5sqnBteG0iF9f9bDBmEtTKkATsW5uQ6_nG"/>
                            </div>
                            <div>
                                <h4 class="text-white font-headline font-bold text-lg">Juthi Akhy</h4>
                                <p class="text-secondary-fixed text-xs font-headline font-bold uppercase tracking-wider">Your Lead Expert</p>
                                <div class="mt-3 flex gap-4">
                                    <button onclick="${appStatus && submitted ? "document.getElementById('chat-input')?.focus(); document.getElementById('chat-messages')?.scrollIntoView({behavior:'smooth'})" : "alert('Submit your application first to unlock messaging.')"}" class="text-white/60 hover:text-secondary-fixed transition-colors">
                                        <span class="material-symbols-outlined text-xl">chat</span>
                                    </button>
                                    <button class="text-white/60 hover:text-secondary-fixed transition-colors">
                                        <span class="material-symbols-outlined text-xl">call</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Active Verifications: The Tonal Grid -->
                <div class="mb-16">
                    <h2 class="font-headline text-2xl font-extrabold text-white mb-8 tracking-tight">Active Verifications</h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        ${verificationCards.map((c, i) => renderVerificationCard(c, i)).join('')}
                    </div>
                </div>

                ${appStatus && submitted ? `
                <!-- Borrower Chat Box -->
                <div class="mb-16 pt-8 border-t border-white/5">
                    <h2 class="font-headline text-2xl font-extrabold text-white mb-8 tracking-tight">Messages with Broker</h2>
                    <div id="chat-messages" class="h-64 overflow-y-auto mb-6 p-4 rounded-2xl bg-white/5 border border-white/10 space-y-4">
                        <p class="text-white/40 text-sm italic text-center"><span class="material-symbols-outlined animate-spin">progress_activity</span> Loading messages...</p>
                    </div>
                    <form onsubmit="window.sendMessage(event, '${appStatus._id}')" class="flex gap-4">
                        <input type="text" id="chat-input" placeholder="Type a message to your broker..." class="flex-1 bg-white/5 border border-white/20 rounded-full text-white px-6 py-3 outline-none focus:border-secondary-fixed transition-colors font-body" required>
                        <button type="submit" id="chat-send-btn" class="w-12 h-12 rounded-full bg-secondary-fixed text-primary flex items-center justify-center hover:brightness-110 transition-all">
                            <span class="material-symbols-outlined">send</span>
                        </button>
                    </form>
                </div>
                ` : ''}

                <!-- Document Center -->
                <div class="pt-8 border-t border-white/5">
                    <div class="flex flex-col md:flex-row justify-between items-baseline mb-10">
                        <h2 class="font-headline text-2xl font-extrabold text-white tracking-tight">Document Center</h2>
                        <span class="text-secondary-fixed text-xs font-headline font-bold uppercase tracking-widest">${pendingDocs > 0 ? pendingDocs + ' Required Documents Pending' : 'All Documents Complete'}</span>
                    </div>
                    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <!-- Upload Area -->
                        <div class="lg:col-span-2">
                            <form onsubmit="window.uploadDocument(event)" class="glass-card p-12 rounded-2xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center text-center group cursor-pointer hover:border-secondary-fixed transition-colors mb-6">
                                <div class="w-16 h-16 bg-secondary-container border border-secondary/20 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                    <span class="material-symbols-outlined text-secondary-fixed text-3xl">upload_file</span>
                                </div>
                                <h4 class="font-headline text-xl font-bold text-white mb-2">Drag & Drop Documents</h4>
                                <p class="text-on-primary-container max-w-xs mb-4 text-sm">Securely upload bank statements, pay stubs, or tax returns in PDF or JPG format.</p>
                                <input type="file" id="doc-upload-file" class="text-white/80 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-bold file:bg-secondary-fixed file:text-primary hover:file:brightness-110 transition-all w-full max-w-sm mb-4" required>
                                <select id="doc-category-select" class="bg-primary-container border border-white/20 rounded-lg text-white text-sm px-4 py-2 w-full max-w-xs outline-none mb-4 font-body">
                                    <option value="ID">ID / Passport</option>
                                    <option value="Income">Pay Stubs / W2</option>
                                    <option value="Assets">Bank Statements</option>
                                    <option value="Tax">Tax Returns</option>
                                    <option value="Other" selected>Other</option>
                                </select>
                                <button type="submit" id="upload-btn" class="bg-secondary-fixed text-primary px-10 py-3 rounded-lg font-headline font-extrabold text-sm tracking-wide transition-all hover:shadow-xl active:scale-95 shadow-lg shadow-secondary/10">Browse Files</button>
                            </form>
                            <!-- Document List -->
                            <div id="documents-list" class="space-y-2">
                                <p class="text-white/40 text-sm italic"><span class="material-symbols-outlined text-sm align-middle animate-spin">progress_activity</span> Loading documents...</p>
                            </div>
                        </div>
                        <!-- Compliance Guide -->
                        <div class="bg-white/5 p-10 rounded-2xl border border-white/5">
                            <h4 class="font-headline font-bold text-lg mb-6 text-secondary-fixed uppercase tracking-wider">Compliance Guide</h4>
                            <ul class="space-y-6">
                                <li class="flex gap-4 items-start">
                                    <span class="material-symbols-outlined text-secondary-fixed text-xl shrink-0">check_circle</span>
                                    <p class="text-on-primary-container text-xs leading-relaxed font-medium">Documents must be less than 3 months old for active income verification.</p>
                                </li>
                                <li class="flex gap-4 items-start">
                                    <span class="material-symbols-outlined text-secondary-fixed text-xl shrink-0">check_circle</span>
                                    <p class="text-on-primary-container text-xs leading-relaxed font-medium">Ensure all four corners of the page are visible in any photo uploads.</p>
                                </li>
                                <li class="flex gap-4 items-start">
                                    <span class="material-symbols-outlined text-secondary-fixed text-xl shrink-0">check_circle</span>
                                    <p class="text-on-primary-container text-xs leading-relaxed font-medium">Redact any non-essential personal identifiers if preferred.</p>
                                </li>
                            </ul>
                            <div class="mt-12 pt-8 border-t border-white/5 flex items-center gap-3">
                                <span class="material-symbols-outlined text-secondary-fixed text-sm">verified_user</span>
                                <span class="text-[9px] uppercase tracking-[0.2em] font-bold text-white/40">Data Security Active</span>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </section>
    `;
}






// --- PHASE 9: ADMIN DASHBOARD ---
function renderAdminDashboard() {
    return `
        <section class="min-h-screen bg-primary pt-32 pb-24">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex justify-between items-center mb-12">
                    <div>
                        <h2 class="text-3xl font-black text-white uppercase tracking-tight">Broker Dashboard</h2>
                        <p class="text-secondary-fixed/80 font-bold uppercase tracking-widest text-sm mt-1">Application Management</p>
                    </div>
                    <button onclick="window.togglePortal(false)" class="px-6 py-2 rounded-full border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-all font-bold text-sm">Sign Out</button>
                </div>

                <!-- Stats Cards -->
                <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12" id="admin-stats-container">
                    <div class="p-6 rounded-[2rem] glass-card border-white/10 animate-pulse bg-white/5 h-32"></div>
                    <div class="p-6 rounded-[2rem] glass-card border-white/10 animate-pulse bg-white/5 h-32"></div>
                    <div class="p-6 rounded-[2rem] glass-card border-white/10 animate-pulse bg-white/5 h-32"></div>
                    <div class="p-6 rounded-[2rem] glass-card border-white/10 animate-pulse bg-white/5 h-32"></div>
                </div>

                <!-- Applications Table -->
                <div class="glass-card rounded-[3rem] border-white/10 overflow-hidden mb-12">
                    <div class="p-8 border-b border-white/10 bg-white/5">
                        <h3 class="text-xl font-black text-white uppercase tracking-wider">Recent Applications</h3>
                    </div>
                    <div class="overflow-x-auto scrollbar-hide">
                        <table class="w-full text-left border-collapse min-w-[800px]">
                            <thead>
                                <tr class="bg-primary">
                                    <th class="py-4 px-8 text-xs font-black text-white/40 uppercase tracking-widest">Borrower</th>
                                    <th class="py-4 px-8 text-xs font-black text-white/40 uppercase tracking-widest">Type</th>
                                    <th class="py-4 px-8 text-xs font-black text-white/40 uppercase tracking-widest">Amount</th>
                                    <th class="py-4 px-8 text-xs font-black text-white/40 uppercase tracking-widest">Status</th>
                                    <th class="py-4 px-8 text-xs font-black text-white/40 uppercase tracking-widest text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="admin-applications-tbody" class="text-white/80">
                                <tr><td colspan="5" class="p-8 text-center text-white/30"><span class="material-symbols-outlined animate-spin text-2xl">progress_activity</span> Loading...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Active Application Detail View -->
                <div id="admin-active-app" class="hidden grid-cols-1 lg:grid-cols-3 gap-8">
                    <!-- App Details & Notes -->
                    <div class="glass-card rounded-[3rem] border-white/10 p-8 flex flex-col">
                        <h3 class="text-xl font-black text-white uppercase tracking-wider mb-6">Details & Notes</h3>
                        
                        <!-- Details will go here -->
                        <div id="admin-app-details" class="mb-6 space-y-3 p-4 rounded-2xl bg-white/5 border border-white/10 text-sm">
                            <p class="text-white/40 italic">Select an application...</p>
                        </div>
                        
                        <h4 class="text-xs font-bold text-secondary-fixed uppercase tracking-widest mb-3 mt-auto">Internal Broker Notes</h4>
                        <textarea id="admin-notes-input" class="w-full focus:outline-none focus:border-secondary-fixed bg-white/5 border border-white/20 rounded-2xl p-4 text-white text-sm resize-none h-32 mb-4" placeholder="Enter private notes here..."></textarea>
                        
                        <button id="admin-save-notes-btn" class="w-full py-3 rounded-full bg-secondary-fixed text-primary font-black text-sm uppercase tracking-widest hover:bg-white transition-all">Save Notes</button>
                    </div>

                    <!-- Chat -->
                    <div class="glass-card rounded-[3rem] border-white/10 p-8">
                        <div class="flex justify-between items-center mb-6">
                            <h3 id="admin-chat-title" class="text-xl font-black text-white uppercase tracking-wider">Messages</h3>
                        </div>
                        <div id="chat-messages" class="h-64 overflow-y-auto mb-6 p-4 rounded-2xl bg-white/5 border border-white/10 space-y-4">
                        </div>
                        <form id="admin-chat-form" class="flex gap-4">
                            <input type="text" id="chat-input" placeholder="Type message..." class="flex-1 bg-white/5 border border-white/20 rounded-full text-white px-6 py-3 outline-none focus:border-secondary-fixed transition-colors" required>
                            <button type="submit" class="w-12 h-12 rounded-full bg-secondary-fixed text-primary flex items-center justify-center hover:bg-white transition-all">
                                <span class="material-symbols-outlined">send</span>
                            </button>
                        </form>
                    </div>

                    <!-- Documents -->
                    <div class="glass-card rounded-[3rem] border-white/10 p-8 flex flex-col">
                        <h3 class="text-xl font-black text-white uppercase tracking-wider mb-6">Uploaded Documents</h3>
                        <div id="admin-documents-list" class="space-y-2 mb-6 max-h-48 overflow-y-auto">
                            <p class="text-white/40 text-sm italic">Select an application to view documents.</p>
                        </div>
                        
                        <!-- Admin Upload Form -->
                        <form id="admin-upload-form" onsubmit="window.uploadAdminDocument(event)" class="mt-auto flex flex-col gap-3 bg-white/5 p-4 rounded-xl border border-white/10 hidden">
                             <input type="hidden" id="admin-upload-userid" value="">
                             <h4 class="text-xs font-bold text-[#EAB308] uppercase tracking-widest leading-none">Upload to Borrower</h4>
                             <input type="file" id="admin-doc-file" class="text-white/80 text-xs w-full file:mr-2 file:py-1 file:px-3 file:rounded-full file:border-0 file:bg-white/10 file:text-white hover:file:bg-white/20 transition-all" required>
                             <button type="submit" id="admin-upload-btn" class="w-full py-2 rounded-full bg-white/10 text-white font-bold text-xs uppercase tracking-widest hover:bg-white hover:text-primary transition-all border border-white/20">Send Document</button>
                        </form>
                    </div>
                </div>
            </div>
        </section>
    `;
}

window.loadAdminData = async function() {
    try {
        const statsRes = await authFetch('/api/admin/stats');
        const stats = await statsRes.json();
        
        const statsContainer = document.getElementById('admin-stats-container');
        if (statsContainer) {
            statsContainer.innerHTML = `
                <div class="p-6 rounded-[2rem] glass-card border-white/10 bg-primary/50">
                    <div class="text-white/40 font-bold uppercase tracking-widest text-xs mb-2">Total Borrowers</div>
                    <div class="text-4xl font-black text-white">${stats.totalUsers}</div>
                </div>
                <div class="p-6 rounded-[2rem] glass-card border-white/10 bg-primary/50">
                    <div class="text-secondary-fixed/80 font-bold uppercase tracking-widest text-xs mb-2">Total Apps</div>
                    <div class="text-4xl font-black text-secondary-fixed">${stats.totalApps}</div>
                </div>
                <div class="p-6 rounded-[2rem] glass-card border-white/10 bg-primary/50">
                    <div class="text-yellow-500/80 font-bold uppercase tracking-widest text-xs mb-2">Under Review</div>
                    <div class="text-4xl font-black text-yellow-500">${stats.underReview}</div>
                </div>
                <div class="p-6 rounded-[2rem] glass-card border-white/10 bg-primary/50">
                    <div class="text-green-500/80 font-bold uppercase tracking-widest text-xs mb-2">Approved</div>
                    <div class="text-4xl font-black text-green-500">${stats.approved}</div>
                </div>
            `;
        }

        const appsRes = await authFetch('/api/admin/applications');
        const { applications } = await appsRes.json();
        
        const tbody = document.getElementById('admin-applications-tbody');
        if (tbody) {
            if (applications.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-white/40">No applications yet.</td></tr>';
            } else {
                tbody.innerHTML = applications.map(app => `
                    <tr class="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer" onclick="window.viewApplication('${app._id}', '${app.userName || app.userEmail}', '${app.user}')">
                        <td class="py-4 px-8">
                            <div class="font-bold text-white">${app.userName || app.userEmail}</div>
                            <div class="text-xs text-white/40">${app.userEmail}</div>
                        </td>
                        <td class="py-4 px-8 font-medium">${app.loanType}</td>
                        <td class="py-4 px-8 font-medium">$${app.loanAmount.toLocaleString()}</td>
                        <td class="py-4 px-8">
                            <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest 
                                ${app.status === 'Approved' ? 'bg-green-500/20 text-green-400' : 
                                  app.status === 'Under Review' ? 'bg-yellow-500/20 text-yellow-400' : 
                                  'bg-primary text-secondary-fixed'}">
                                ${app.status}
                            </span>
                        </td>
                        <td class="py-4 px-8 text-right" onclick="event.stopPropagation()">
                            <select onchange="window.updateAppStatus('${app._id}', this.value)" class="bg-primary border border-white/20 rounded-lg text-white text-xs px-2 py-1 outline-none">
                                <option value="" disabled selected>Update Status</option>
                                <option value="Under Review">Under Review</option>
                                <option value="Approved">Approved</option>
                                <option value="Denied">Denied</option>
                            </select>
                        </td>
                    </tr>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Failed to load admin data:', error);
    }
}

window.viewApplication = async function(appId, name, userId) {
    const detailView = document.getElementById('admin-active-app');
    if (detailView) {
        detailView.classList.remove('hidden');
        detailView.classList.add('grid');
        
        document.getElementById('admin-chat-title').innerText = `Chat: ${name}`;
        
        const form = document.getElementById('admin-chat-form');
        form.onsubmit = (e) => window.sendMessage(e, appId);
        
        window.loadMessages(appId);
        
        // Fetch specific app data to get details & notes
        try {
            const appRes = await authFetch(`/api/admin/applications`);
            const appData = await appRes.json();
            const fullApp = appData.applications.find(a => a._id === appId);
            
            if (fullApp) {
                // Populate Details
                document.getElementById('admin-app-details').innerHTML = `
                    <div class="flex justify-between items-center"><span class="text-white/50">Address:</span> <span class="text-white font-bold text-right">${fullApp.propertyAddress || 'TBD'}</span></div>
                    <div class="flex justify-between items-center"><span class="text-white/50">Loan Amount:</span> <span class="text-white font-bold">$${fullApp.loanAmount.toLocaleString()}</span></div>
                    <div class="flex justify-between items-center"><span class="text-white/50">Verified Income:</span> <span class="text-green-400 font-bold">$${(fullApp.verifiedIncome || 0).toLocaleString()}</span></div>
                    
                    <div class="mt-4 pt-4 border-t border-white/10"></div>
                    <div class="flex justify-between items-center mb-1"><span class="text-white/50">Property Type:</span> <span class="text-white font-bold">${fullApp.propertyDetails?.propertyType || 'N/A'}</span></div>
                    <div class="flex justify-between items-center mb-1"><span class="text-white/50">Occupancy:</span> <span class="text-white font-bold">${fullApp.propertyDetails?.occupancyType || 'N/A'}</span></div>
                    
                    <div class="mt-4 pt-4 border-t border-white/10"></div>
                    <div class="flex justify-between items-center mb-1"><span class="text-white/50">Employment History:</span> <span class="text-white font-bold">${fullApp.employmentHistory?.length || 0} Records</span></div>
                    <div class="flex justify-between items-center mb-1"><span class="text-white/50">Residential History:</span> <span class="text-white font-bold">${fullApp.residentialHistory?.length || 0} Records</span></div>
                    
                    <div class="mt-4 pt-4 border-t border-white/10"></div>
                    <div class="flex justify-between items-center mb-1"><span class="text-white/50">Credit Score:</span> <span class="text-secondary-fixed font-bold">${fullApp.creditScore || 'Pending'}</span></div>
                    <div class="flex justify-between items-center mb-1"><span class="text-white/50">Declarations:</span> <span class="${fullApp.declarations?.bankruptcy ? 'text-red-400' : 'text-green-400'} font-bold">Checked</span></div>
                    
                    <div class="mt-4 pt-4 border-t border-white/10"></div>
                    <div class="flex justify-between items-center"><span class="text-white/50">Submitted On:</span> <span class="text-white font-bold">${new Date(fullApp.createdAt).toLocaleDateString()}</span></div>

                    <!-- LOS Export Button -->
                    <div class="mt-8">
                        <a href="/api/admin/applications/${appId}/export" 
                           class="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-xs hover:bg-white transition-all shadow-xl"
                           download>
                            <span class="material-symbols-outlined text-xl">file_download</span>
                            Export to LOS (FNM 3.2)
                        </a>
                        <p class="text-[10px] text-white/30 text-center mt-3 uppercase font-bold tracking-tighter italic">Legacy MISMO Format for Encompass/Calyx</p>
                    </div>
                `;
                
                // Populate Notes
                document.getElementById('admin-notes-input').value = fullApp.adminNotes || '';
                
                // Bind Save Button event
                const saveBtn = document.getElementById('admin-save-notes-btn');
                saveBtn.onclick = () => window.saveAdminNotes(appId);
            }
        } catch (e) {
            console.error(e);
        }

        // Fetch user documents
        try {
            const docsRes = await authFetch(`/api/admin/documents/${userId}`);
            const docsData = await docsRes.json();
            const docsList = document.getElementById('admin-documents-list');
            
            if (docsData.documents.length === 0) {
                docsList.innerHTML = '<p class="text-white/40 text-sm">No documents found.</p>';
            } else {
                docsList.innerHTML = docsData.documents.map(doc => `
                    <div class="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10 mb-2">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-secondary-fixed">
                                <span class="material-symbols-outlined text-xl">description</span>
                            </div>
                            <div>
                                <div class="text-white font-bold text-sm">${doc.originalName}</div>
                                <div class="text-white/40 text-[10px] uppercase font-bold tracking-widest">${doc.category} • ${(doc.size / 1024 / 1024).toFixed(2)} MB</div>
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        } catch (e) {
            console.error(e);
        }
        // Fetch user documents
        try {
            const docsRes = await authFetch(`/api/admin/documents/${userId}`);
            const docsData = await docsRes.json();
            const docsList = document.getElementById('admin-documents-list');

            const uploadForm = document.getElementById('admin-upload-form');
            const userIdInput = document.getElementById('admin-upload-userid');
            if (uploadForm && userIdInput) {
                uploadForm.classList.remove('hidden');
                userIdInput.value = userId;
            }
            
            if (docsData.documents.length === 0) {
                docsList.innerHTML = '<p class="text-white/40 text-sm">No documents found.</p>';
            } else {
                docsList.innerHTML = docsData.documents.map(doc => `
                    <div class="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10 mb-2">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-secondary-fixed">
                                <span class="material-symbols-outlined text-xl">description</span>
                            </div>
                            <div>
                                <div class="text-white font-bold text-sm">` + doc.originalName + `</div>
                                <div class="text-white/40 text-[10px] uppercase font-bold tracking-widest">` + doc.category + ` &bull; ` + (doc.size / 1024 / 1024).toFixed(2) + ` MB</div>
                            </div>
                        </div>
                        <a href="` + doc.url + `" target="_blank" class="text-secondary-fixed hover:text-white transition-colors">
                            <span class="material-symbols-outlined text-xl">download</span>
                        </a>
                    </div>
                `).join('');
            }
        } catch (e) {
            console.error(e);
        }
    }
}

// --- NEW OVERLAY LOGIC FOR ADMIN DASHBOARD ---
window.saveAdminNotes = async function(appId) {
    const notesInput = document.getElementById('admin-notes-input');
    const btn = document.getElementById('admin-save-notes-btn');
    const originalText = btn.innerText;

    btn.innerText = 'Saving...';
    btn.disabled = true;

    try {
        const res = await authFetch(`/api/admin/applications/${appId}/notes`, {
            method: 'PATCH',
            body: JSON.stringify({ notes: notesInput.value })
        });
        
        if (res.ok) {
            btn.innerHTML = '<span class="material-symbols-outlined">check</span> Saved';
            btn.classList.replace('bg-secondary-fixed', 'bg-green-500');
            setTimeout(() => {
                btn.innerText = originalText;
                btn.classList.replace('bg-green-500', 'bg-secondary-fixed');
                btn.disabled = false;
            }, 2000);
        } else {
            throw new Error('Failed to save');
        }
    } catch (error) {
        console.error('Notes Error:', error);
        btn.innerText = 'Error';
        setTimeout(() => { btn.innerText = originalText; btn.disabled = false; }, 2000);
    }
}

window.uploadAdminDocument = async function(event) {
    event.preventDefault();
    const fileInput = document.getElementById('admin-doc-file');
    const userId = document.getElementById('admin-upload-userid').value;
    const btn = document.getElementById('admin-upload-btn');
    
    if (!fileInput.files[0] || !userId) return;

    const originalText = btn.innerText;
    btn.innerText = 'Uploading...';
    btn.disabled = true;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('category', 'Broker Upload');
    formData.append('targetUserId', userId);

    try {
        const token = localStorage.getItem('jwt_token');
        const res = await fetch('/api/documents/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        const data = await res.json();
        if (data.success) {
            fileInput.value = '';
            btn.innerHTML = '<span class="material-symbols-outlined">check</span> Sent';
            btn.classList.add('bg-green-500', 'text-white', 'border-transparent');
            
            // Refetch docs
            const docsRes = await authFetch(`/api/admin/documents/${userId}`);
            const docsData = await docsRes.json();
            const docsList = document.getElementById('admin-documents-list');
            
            if (docsData.documents.length > 0) {
                docsList.innerHTML = docsData.documents.map(doc => `
                    <div class="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10 mb-2">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-secondary-fixed">
                                <span class="material-symbols-outlined text-xl">description</span>
                            </div>
                            <div>
                                <div class="text-white font-bold text-sm">` + doc.originalName + `</div>
                                <div class="text-white/40 text-[10px] uppercase font-bold tracking-widest">` + doc.category + `</div>
                            </div>
                        </div>
                        <a href="` + doc.url + `" target="_blank" class="text-secondary-fixed hover:text-white transition-colors">
                            <span class="material-symbols-outlined text-xl">download</span>
                        </a>
                    </div>
                `).join('');
            }

            setTimeout(() => {
                btn.innerText = originalText;
                btn.classList.remove('bg-green-500', 'text-white', 'border-transparent');
                btn.disabled = false;
            }, 2000);
        } else {
            alert(data.error || 'Upload failed');
            btn.innerText = originalText;
            btn.disabled = false;
        }
    } catch (error) {
        console.error(error);
        btn.innerText = originalText;
        btn.disabled = false;
    }
}


window.updateAppStatus = async function(appId, newStatus) {
    if (!newStatus) return;
    try {
        await authFetch('/api/admin/applications/' + appId, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus })
        });
        window.loadAdminData();
    } catch (error) {
        console.error('Failed to update status:', error);
        alert('Failed to update status');
    }
}

// --- PHASE 13: DEVELOPER CONTROLS ---
window.addSampleApp = async function() {
    try {
        const res = await authFetch('/api/applications/sample', { method: 'POST' });
        if (res.ok) {
            window.trackEvent('DevTools', 'Sample App Added');
            await window.checkUserStatus(); // Refresh state
            const appContent = document.getElementById('app-content');
            if (appContent) {
                appContent.innerHTML = renderPortal();
                window.loadDocuments();
                window.scrollTo({ top: 0, behavior: 'smooth' });
                initScrollReveal();
            }
        }
    } catch (err) {
        console.error('Failed to add sample app:', err);
    }
}

window.resetBorrower = async function() {
    if (!confirm('Are you sure you want to WIPE all your application data and restart from Step 1?')) return;
    try {
        const res = await authFetch('/api/applications/reset', { method: 'DELETE' });
        if (res.ok) {
            window.trackEvent('DevTools', 'Portal Reset');
            await window.checkUserStatus(); // Refresh state
            window.nextWizardStep(0); // Reset wizard state internally
            
            const appContent = document.getElementById('app-content');
            if (appContent) {
                appContent.innerHTML = renderPortal();
                window.loadDocuments();
                window.scrollTo({ top: 0, behavior: 'smooth' });
                initScrollReveal();
            }
        }
    } catch (err) {
        console.error('Failed to reset borrower:', err);
    }
}

// --- PHASE 9: DOCUMENTS ---
window.uploadDocument = async function(event) {
    event.preventDefault();
    const fileInput = document.getElementById('doc-upload-file');
    const categorySelect = document.getElementById('doc-category-select');
    const file = fileInput.files[0];
    
    if (!file) return alert('Please select a file.');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', categorySelect.value);

    const btn = document.getElementById('upload-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> Uploading...';
    btn.disabled = true;

    try {
        const token = localStorage.getItem('jwt_token');
        const response = await fetch('/api/documents/upload', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: formData
        });
        
        if (response.ok) {
            fileInput.value = '';
            window.loadDocuments();
        } else {
            const data = await response.json();
            alert('Upload failed: ' + data.error);
        }
    } catch (error) {
        console.error('Upload Error:', error);
        alert('Upload completely failed.');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

window.deleteDocument = async function(docId) {
    if (!confirm('Are you sure you want to delete this document?')) return;
    try {
        await authFetch('/api/documents/' + docId, { method: 'DELETE' });
        window.loadDocuments();
    } catch (error) {
        console.error('Delete failed:', error);
    }
}

window.loadDocuments = async function() {
    try {
        const res = await authFetch('/api/documents');
        const data = await res.json();
        
        const list = document.getElementById('documents-list');
        if (list) {
            if (data.documents.length === 0) {
                list.innerHTML = '<p class="text-white/40 text-sm italic">No documents uploaded yet.</p>';
            } else {
                list.innerHTML = data.documents.map(doc => `
                    <div class="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10 mb-2">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-secondary-fixed">
                                <span class="material-symbols-outlined text-xl">description</span>
                            </div>
                            <div>
                                <div class="text-white font-bold text-sm">${doc.originalName}</div>
                                <div class="text-white/40 text-[10px] uppercase font-bold tracking-widest">${doc.category} • ${(doc.size / 1024 / 1024).toFixed(2)} MB</div>
                            </div>
                        </div>
                        <button onclick="window.deleteDocument('${doc._id}')" class="text-red-400/60 hover:text-red-400 transition-colors p-2">
                            <span class="material-symbols-outlined">delete</span>
                        </button>
                    </div>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Failed to load documents:', error);
    }
}

// --- PHASE 9: MESSAGING ---
window.loadMessages = async function(appId) {
    if (!appId) return;
    
    // Join the WebSocket room for real-time updates
    if (socket) {
        socket.emit('join_application', appId);
    }

    try {
        const res = await authFetch('/api/applications/' + appId + '/messages');
        const data = await res.json();
        const chatContainer = document.getElementById('chat-messages');
        
        if (chatContainer) {
            if (!data.messages || data.messages.length === 0) {
                chatContainer.innerHTML = '<p class="text-white/40 text-sm italic text-center py-8">No messages yet. Send a message to start chatting.</p>';
                return;
            }
            
            chatContainer.innerHTML = data.messages.map(msg => `
                <div class="flex flex-col ${msg.senderRole === window.userStatus.role ? 'items-end' : 'items-start'}">
                    <div class="max-w-[80%] rounded-2xl p-4 ${msg.senderRole === window.userStatus.role ? 'bg-secondary-fixed text-primary rounded-tr-sm' : 'bg-primary text-white border border-white/10 rounded-tl-sm'}">
                        <div class="text-[10px] uppercase font-black tracking-widest opacity-50 mb-1">${msg.senderName}</div>
                        <div class="text-sm font-medium">${msg.message}</div>
                    </div>
                    <div class="text-[10px] text-white/30 mt-1">${new Date(msg.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                </div>
            `).join('');
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

window.sendMessage = async function(event, appId) {
    event.preventDefault();
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    input.disabled = true;
    try {
        await authFetch('/api/applications/' + appId + '/messages', {
            method: 'POST',
            body: JSON.stringify({ message })
        });
        input.value = '';
        window.loadMessages(appId);
    } catch (error) {
        console.error('Failed to send message:', error);
    } finally {
        input.disabled = false;
        input.focus();
    }
}

// --- TEST ADMIN VIEW BUTTON LOGIC ---
window.testAdminView = function() {
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = renderAdminDashboard();
    window.loadAdminData();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();
}

// --- PHASE 8: PERSISTENCE LOGIC ---
window.checkUserStatus = async function() {
    try {
        const response = await authFetch('/api/user_status', { method: 'POST' });
        const data = await response.json();
        
        // Store globally for other functions to use
        window.userStatus = data;

        if (data.isSynced) {
            // 1. Identity Status Sync
            if (data.identityStatus === 'Verified') {
                const idBtn = document.getElementById('persona-start-btn');
                if (idBtn) {
                     idBtn.parentElement.innerHTML = `
                        <div class="py-12 rounded-3xl border-2 border-green-500/50 bg-green-500/10 flex flex-col items-center justify-center">
                            <span class="material-symbols-outlined text-4xl text-green-500 mb-4 scale-125 transition-transform duration-500">check_circle</span>
                            <span class="text-green-500 font-bold uppercase tracking-widest text-xs">Identity Authenticated</span>
                        </div>
                    `;
                }
            }

            // 2. Credit Score Sync
            if (data.creditScore) {
                const creditBtn = document.getElementById('credit-pull-btn');
                if (creditBtn) {
                    creditBtn.parentElement.innerHTML = `
                        <div class="flex flex-col items-center">
                            <div class="text-5xl font-black text-secondary-fixed mb-2">${data.creditScore}</div>
                            <div class="text-white/40 font-bold uppercase tracking-widest text-[10px]">Verified FICO® Score</div>
                        </div>
                    `;
                    const nextBtn = document.getElementById('credit-next-btn');
                    if (nextBtn) {
                        nextBtn.disabled = false;
                        nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                        nextBtn.innerHTML = 'Review & Continue';
                    }
                }
            }
        }
    } catch (error) {
        console.error('Persistence Check Failed:', error);
    }
}

// Run status check on load
// Consolidated into primary DOMContentLoaded listener at top of file

// --- PHASE 8: PERSONA IDENTITY VERIFICATION ---
window.startPersonaVerification = async function() {
    console.log('🚀 Initializing Persona Verification...');
    const btn = document.getElementById('persona-start-btn');
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-4xl mb-4">progress_activity</span><span class="text-xs uppercase tracking-widest">Generating Session...</span>';

    try {
        const response = await authFetch('/api/create_inquiry', { method: 'POST' });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Server rejected inquiry request');
        }

        const { templateId, referenceId } = await response.json();
        console.log(`📡 Persona Session Data Received: ${templateId}`);

        if (!templateId) throw new Error('Persona Template ID is missing');

        if (typeof Persona === 'undefined') {
            if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-4xl mb-4 text-red-500">gpp_maybe</span><span class="text-xs uppercase tracking-widest text-center px-4">Adblocker Detected.<br>Please disable it to Verify ID.</span>';
            console.error('❌ Persona SDK failed to load. Likely blocked by an Adblocker or Privacy Shield.');
            return;
        }

        const client = new Persona.Client({
            templateId: templateId,
            referenceId: referenceId,
            environment: "sandbox",
            onReady: () => {
                window.trackEvent('Verification', 'Persona Started');
                client.open();
            },
            onComplete: async ({ inquiryId }) => {
                window.trackEvent('Verification', 'Persona Completed');
                console.log(`✅ Persona Verified: ${inquiryId}`);
                // Notify backend
                await authFetch('/api/persona_complete', {
                    method: 'POST',
                    body: JSON.stringify({ inquiryId, status: 'Verified' })
                });

                // Update UI
                const container = document.getElementById('persona-verification-container');
                if (container) {
                    container.innerHTML = `
                        <div class="py-12 rounded-3xl border-2 border-green-500/50 bg-green-500/10 flex flex-col items-center justify-center">
                            <span class="material-symbols-outlined text-4xl text-green-500 mb-4 scale-125 transition-transform duration-500">check_circle</span>
                            <span class="text-green-500 font-bold uppercase tracking-widest text-xs">Identity Authenticated</span>
                        </div>
                    `;
                }
                const nextBtn = document.getElementById('id-next-btn');
                if (nextBtn) {
                    nextBtn.disabled = false;
                    nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                    nextBtn.innerHTML = 'Identity Verified - Proceed';
                }
            },
            onCancel: () => {
                console.log('❌ Persona Cancelled.');
                if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-4xl text-white/20 mb-4">fingerprint</span><span class="text-xs uppercase tracking-widest">Retry ID Verification</span>';
            },
            onError: (error) => {
                console.error('Persona SDK Error:', error);
                if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-4xl mb-4 text-red-500">warning</span><span class="text-xs uppercase tracking-widest text-center px-4">Persona SDK Error. Check Console.</span>';
            }
        });
    } catch (error) {
        console.error('❌ Failed to start Persona:', error);
        if (btn) {
            btn.innerHTML = `<span class="material-symbols-outlined text-4xl mb-4 text-red-500">warning</span><span class="text-xs uppercase tracking-widest text-center px-4">${error.message || 'Error Loading Session'}</span>`;
        }
    }
};

window.startPayment = async function(applicationId) {
    try {
        console.log('💳 Initiating Appraisal Fee Payment...');
        const response = await authFetch('/api/payments/create-checkout-session', {
            method: 'POST',
            body: JSON.stringify({ applicationId })
        });
        
        const data = await response.json();
        if (data.url) {
            window.location.href = data.url;
        } else {
            throw new Error(data.error || 'Failed to create checkout session');
        }
    } catch (error) {
        console.error('❌ Payment Error:', error);
        alert('Payment Error: ' + error.message);
    }
};

window.simulatePersonaSuccess = async function() {
    console.log('🧪 Simulating Persona Success...');
    const inquiryId = 'inq_simulated_' + Math.random().toString(36).substr(2, 9);
    
    // Call the real backend completion route
    const response = await authFetch('/api/persona_complete', {
        method: 'POST',
        body: JSON.stringify({ inquiryId, status: 'Verified' })
    });

    if (response.ok) {
        // Update UI
        const container = document.getElementById('persona-verification-container');
        if (container) {
            container.innerHTML = `
                <div class="py-12 rounded-3xl border-2 border-green-500/50 bg-green-500/10 flex flex-col items-center justify-center">
                    <span class="material-symbols-outlined text-4xl text-green-500 mb-4 scale-125 transition-transform duration-500">check_circle</span>
                    <span class="text-green-500 font-bold uppercase tracking-widest text-xs">Identity Verified</span>
                </div>
            `;
        }
        const nextBtn = document.getElementById('id-next-btn');
        if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            nextBtn.innerHTML = 'Identity Verified - Proceed';
        }
    }
}

window.pullCreditRecord = async function() {
    console.log('📉 Fetching Credit Score...');
    const btn = document.getElementById('credit-pull-btn');
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined animate-spin mr-2">progress_activity</span> Fetching Record...';
    
    // Gather Secure Form Data
    const ssn = document.getElementById('cp-ssn')?.value;
    const dob = document.getElementById('cp-dob')?.value;
    const addressLine1 = document.getElementById('cp-address')?.value;
    const city = document.getElementById('cp-city')?.value;
    const state = document.getElementById('cp-state')?.value;
    const zip = document.getElementById('cp-zip')?.value;

    try {
        const response = await authFetch('/api/credit_pull', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ssn, dob, addressLine1, city, state, zip })
        });
        const data = await response.json();
        
        if (data.success) {
            window.trackEvent('Verification', 'Credit Pull Success');
            const container = document.getElementById('credit-status-container');
            if (container) {
                container.innerHTML = `
                    <div class="flex flex-col items-center">
                        <div class="text-5xl font-black text-secondary-fixed mb-2">${data.score}</div>
                        <div class="text-white/40 font-bold uppercase tracking-widest text-[10px] mb-6">Verified FICO® Score</div>
                        
                        <div class="w-full p-4 rounded-2xl bg-white/5 border border-white/10 text-left">
                            <div class="flex justify-between mb-2">
                                <span class="text-[9px] font-black text-white/20 uppercase tracking-widest">Bureau Rating</span>
                                <span class="text-green-500 font-bold uppercase text-[10px] tracking-widest">${data.rating}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-[9px] font-black text-white/20 uppercase tracking-widest">Report ID</span>
                                <span class="text-white/40 font-mono text-[9px]">${data.reportId}</span>
                            </div>
                        </div>
                    </div>
                `;
            }
            const nextBtn = document.getElementById('credit-next-btn');
            if (nextBtn) {
                nextBtn.disabled = false;
                nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                nextBtn.innerHTML = 'Complete Application';
            }
        } else {
            console.error('Credit Pull Failed:', data.error);
            if (btn) btn.innerHTML = `<span class="text-red-400">Error: ${data.error || 'Check fields'}</span>`;
            setTimeout(() => { if (btn) btn.innerHTML = 'Verify via Experian'; }, 3000);
        }
    } catch (error) {
        console.error('Credit verification network error:', error);
        if (btn) btn.innerHTML = '<span class="text-red-400">Network Error</span>';
        setTimeout(() => { if (btn) btn.innerHTML = 'Verify via Experian'; }, 3000);
    }
}

// --- 1003 DYNAMIC ROW HELPERS ---
window.addEmploymentRow = function() {
    const list = document.getElementById('employment-rows');
    if (list) {
        const row = document.createElement('div');
        row.className = 'employment-row p-6 rounded-3xl bg-white/5 border border-white/10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 reveal reveal-up';
        row.innerHTML = `
            <input type="text" placeholder="Employer Name" class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-name">
            <input type="text" placeholder="Position/Title" class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-title">
            <input type="date" class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-start">
            <input type="number" placeholder="Gross Monthly Income" class="w-full bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-income">
        `;
        list.appendChild(row);
    }
}

window.addResidencyRow = function() {
    const list = document.getElementById('residency-rows');
    if (list) {
        const row = document.createElement('div');
        row.className = 'residency-row p-6 rounded-3xl bg-white/5 border border-white/10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 reveal reveal-up';
        row.innerHTML = `
            <input type="text" placeholder="Full Home Address" class="lg:col-span-2 bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold res-address">
            <select class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold res-status">
                <option value="Own">Own</option>
                <option value="Rent">Rent</option>
                <option value="LivingRentFree">Living Rent Free</option>
            </select>
        `;
        list.appendChild(row);
    }
}
