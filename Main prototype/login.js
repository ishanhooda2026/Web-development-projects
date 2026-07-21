/* Login flow controller */

let currentPhone = '';
let pendingNewUser = false;
let selectedRole = null;

const steps = {
  phone: document.getElementById('step-phone'),
  otp: document.getElementById('step-otp'),
  role: document.getElementById('step-role'),
  newbuilder: document.getElementById('step-newbuilder'),
  newsupervisor: document.getElementById('step-newsupervisor'),
  newworker: document.getElementById('step-newworker'),
  notfound: document.getElementById('step-notfound'),
};

function showStep(name) {
  Object.values(steps).forEach(s => s.classList.add('hidden'));
  steps[name].classList.remove('hidden');
}

const urlParams = new URLSearchParams(window.location.search);
const signupIntent = urlParams.get('intent') === 'signup';
if (signupIntent) {
  document.querySelector('#step-phone p').textContent =
    'Enter a phone number to create a new account. If it\'s already registered, we\'ll sign you straight in.';
}

/* --- Step 1: phone submit --- */
document.getElementById('phoneForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = document.getElementById('phoneInput').value;
  const phone = normalizePhone(raw);
  if (phone.length !== 10) {
    toast('Enter a valid 10-digit phone number.', 'error');
    return;
  }
  currentPhone = phone;

  const existing = findUserByPhone(phone);
  if (!existing && !signupIntent) {
    showStep('notfound');
    return;
  }
  pendingNewUser = !existing;

  const btn = document.getElementById('sendOtpBtn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  setTimeout(() => {
    const code = generateOtp(phone);
    btn.disabled = false;
    btn.textContent = 'Send OTP';
    document.getElementById('phoneDisplay').textContent = '+91 ' + phone;
    const banner = document.getElementById('demoOtpBanner');
    banner.textContent = `Demo Mode (no SMS gateway connected): your OTP is ${code}`;
    banner.classList.add('show');
    showStep('otp');
    document.querySelector('.otp-box').focus();
    toast('OTP generated', 'success');
  }, 500);
});

/* --- OTP box behavior --- */
const otpBoxesEl = document.getElementById('otpBoxes');
otpBoxesEl.addEventListener('input', (e) => {
  const t = e.target;
  if (!t.classList.contains('otp-box')) return;
  t.value = t.value.replace(/\D/g, '');
  if (t.value && t.nextElementSibling) t.nextElementSibling.focus();
});
otpBoxesEl.addEventListener('keydown', (e) => {
  const t = e.target;
  if (!t.classList.contains('otp-box')) return;
  if (e.key === 'Backspace' && !t.value && t.previousElementSibling) {
    t.previousElementSibling.focus();
  }
});
otpBoxesEl.addEventListener('paste', (e) => {
  const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4);
  if (!text) return;
  e.preventDefault();
  const boxes = [...document.querySelectorAll('.otp-box')];
  text.split('').forEach((ch, i) => { if (boxes[i]) boxes[i].value = ch; });
  (boxes[text.length - 1] || boxes[boxes.length - 1]).focus();
});

/* --- Step 2: OTP verify --- */
document.getElementById('otpForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const boxes = [...document.querySelectorAll('.otp-box')];
  const code = boxes.map(b => b.value).join('');
  if (code.length !== 4) {
    toast('Enter all 4 digits.', 'error');
    return;
  }
  const result = verifyOtp(currentPhone, code);
  if (!result.ok) {
    boxes.forEach(b => { b.classList.add('shake'); setTimeout(() => b.classList.remove('shake'), 400); });
    toast(result.reason, 'error');
    return;
  }

  if (pendingNewUser) {
    showStep('role');
    return;
  }

  // Number is already registered — sign straight into whichever
  // role (builder/supervisor/worker) it was originally set up as,
  // regardless of whether we arrived via "Sign In" or "Get Started".
  const user = findUserByPhone(currentPhone);
  completeLogin(user);
});

document.getElementById('resendBtn').addEventListener('click', () => {
  const code = generateOtp(currentPhone);
  const banner = document.getElementById('demoOtpBanner');
  banner.textContent = `Demo Mode (no SMS gateway connected): your OTP is ${code}`;
  banner.classList.add('show');
  toast('New OTP generated', 'success');
});

document.getElementById('changeNumberBtn').addEventListener('click', () => showStep('phone'));
const tryAgainBtn = document.getElementById('tryAgainBtn');
if (tryAgainBtn) tryAgainBtn.addEventListener('click', () => showStep('phone'));

/* --- Step 3: role selection --- */
document.querySelectorAll('.role-choice-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedRole = btn.dataset.role;
    if (selectedRole === 'builder') showStep('newbuilder');
    else if (selectedRole === 'supervisor') showStep('newsupervisor');
    else showStep('newworker');
  });
});
document.getElementById('backFromRoleBtn').addEventListener('click', () => showStep('otp'));
document.getElementById('backFromBuilderBtn').addEventListener('click', () => showStep('role'));
document.getElementById('backFromSupervisorBtn').addEventListener('click', () => showStep('role'));
document.getElementById('backFromWorkerBtn').addEventListener('click', () => showStep('role'));

/* --- Step 4a: new builder registration --- */
document.getElementById('newBuilderForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('builderName').value.trim();
  const company = document.getElementById('builderCompany').value.trim();
  if (!name || !company) return;
  const result = registerBuilder({ name, company, phone: currentPhone });
  if (!result.ok) {
    toast(result.reason, 'error');
    return;
  }
  toast('Account created!', 'success');
  completeLogin(result.user);
});

/* --- Step 4b: new supervisor registration ---
   Self-registers with no project assigned yet; a builder assigns
   them to a project later, same as if the builder had added them. */
document.getElementById('newSupervisorForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('supervisorName').value.trim();
  if (!name) return;
  const result = addSupervisor({ name, phone: currentPhone, projectIds: [], addedBy: null });
  if (!result.ok) {
    toast(result.reason, 'error');
    return;
  }
  toast('Account created!', 'success');
  completeLogin(result.user);
});

/* --- Step 4c: new labour registration ---
   Self-registers with no project assigned yet; a supervisor or
   builder assigns them to a project later. */
document.getElementById('newWorkerSelfForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('workerSelfName').value.trim();
  if (!name) return;
  const result = addWorker({ name, phone: currentPhone, projectId: null, addedBy: null });
  if (!result.ok) {
    toast(result.reason, 'error');
    return;
  }
  toast('Account created!', 'success');
  completeLogin(result.user);
});

function completeLogin(user) {
  setSession(user.id);
  toast(`Welcome, ${user.name.split(' ')[0]}`, 'success');
  setTimeout(() => {
    if (user.role === 'builder') window.location.href = 'builder.html';
    else if (user.role === 'supervisor') window.location.href = 'supervisor.html';
    else window.location.href = 'worker.html';
  }, 500);
}