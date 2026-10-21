const steps = ['file', 'rules', 'review', 'results'];

export function createWizardState() {
  let current = 'file', hasFile = false, hasReport = false, busy = false;
  return {
    get current() { return current; },
    get busy() { return busy; },
    stepStatus(step) {
      if (step === current) return 'current';
      const index = steps.indexOf(step);
      return index >= 0 && index < steps.indexOf(current) ? 'completed' : 'upcoming';
    },
    canNavigate(step) {
      return !busy && steps.includes(step) && (step === 'file' || (hasFile && (step !== 'results' || hasReport)));
    },
    navigate(step) {
      if (!this.canNavigate(step)) return false;
      current = step; return true;
    },
    setFile(available) { hasFile = available; hasReport = false; busy = false; current = 'file'; },
    start() {
      if (!hasFile || busy) return false;
      current = 'review'; busy = true; hasReport = false; return true;
    },
    finish(success) { busy = false; hasReport = success; current = success ? 'results' : 'review'; },
  };
}

export function createWizard(get) {
  const state = createWizardState();
  const buttons = [...get('wizard-steps').querySelectorAll('[data-step]')];
  const labels = { file: 'Data', rules: 'Checks', review: 'Confirm', results: 'Results' };
  function render(focus = false) {
    for (const button of buttons) {
      const active = button.dataset.step === state.current;
      const completed = state.stepStatus(button.dataset.step) === 'completed';
      button.dataset.status = state.stepStatus(button.dataset.step);
      button.setAttribute('aria-label', labels[button.dataset.step] + (completed ? ', completed' : ''));
      const marker = button.querySelector('span');
      marker.textContent = completed || button.dataset.step === 'results' ? '✓' : String(steps.indexOf(button.dataset.step) + 1);
      marker.setAttribute('aria-hidden', 'true');
      button.disabled = !state.canNavigate(button.dataset.step);
      if (active) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    }
    for (const step of ['file', 'rules', 'review', 'results']) get(`step-${step}`).hidden = step !== state.current;
    get('file-next').disabled = !state.canNavigate('rules');
    get('review-back').disabled = state.busy;
    get('recheck').disabled = !state.canNavigate('review');
    get('confirmation-file').textContent = get('file-name').textContent || 'No file selected';
    if (focus) {
      const heading = get(`step-${state.current}`).querySelector('h2');
      heading.focus();
    }
  }
  function navigate(step) {
    if (state.navigate(step)) render(true);
  }
  for (const button of buttons) button.addEventListener('click', () => navigate(button.dataset.step));
  for (const [id, step] of [['file-next', 'rules'], ['rules-back', 'file'], ['rules-next', 'review'], ['review-back', 'rules'], ['edit-checks', 'rules'], ['change-file', 'file']]) get(id).addEventListener('click', () => navigate(step));
  render();
  return {
    setFile(available) { state.setFile(available); render(); },
    start() { const started = state.start(); if (started) render(); return started; },
    finish(success) { state.finish(success); render(true); },
    navigate,
  };
}
