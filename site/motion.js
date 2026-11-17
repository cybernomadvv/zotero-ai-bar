// Motion guidance: github.com/nextlevelbuilder/ui-ux-pro-max-skill.
// Native Web Animations keeps this static site independent of animation packages.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const runningAnimations = new Set();
let userAllowsMotion = true;
try {
  userAllowsMotion = localStorage.getItem('aibar-motion') !== 'off';
} catch {
  // Storage can be unavailable in private or restricted browsing contexts.
}
const toggle = document.createElement('button');
toggle.type = 'button';
toggle.className = 'motion-toggle';
document.body.append(toggle);
const progress = document.createElement('div');
progress.className = 'reading-progress';
progress.setAttribute('aria-hidden', 'true');
const progressBar = document.createElement('span');
progress.append(progressBar);
document.body.append(progress);

function animateEntrance(element, delay = 0, distance = 16, duration = 500) {
  if (document.documentElement.dataset.motion === 'off' || typeof element.animate !== 'function') return;
  const animation = element.animate(
    [
      { opacity: 0.25, transform: `translateY(${distance}px)` },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }
  );
  runningAnimations.add(animation);
  animation.finished.then(
    () => runningAnimations.delete(animation),
    () => runningAnimations.delete(animation)
  );
}

let progressFrame = 0;
function updateProgress() {
  progressFrame = 0;
  const distance = document.documentElement.scrollHeight - innerHeight;
  const position = distance > 0 ? Math.min(1, Math.max(0, scrollY / distance)) : 0;
  progressBar.style.transform = `scaleX(${position})`;
}
function scheduleProgress() {
  if (!progressFrame) progressFrame = requestAnimationFrame(updateProgress);
}
function syncMotionPreference() {
  const enabled = userAllowsMotion && !reducedMotion.matches;
  document.documentElement.dataset.motion = enabled ? 'on' : 'off';
  toggle.textContent = reducedMotion.matches ? '动效 · 跟随系统关闭' : enabled ? '动效 · 开' : '动效 · 关';
  toggle.setAttribute('aria-label', reducedMotion.matches ? '系统设置已减少动态效果' : enabled ? '关闭网页动效' : '开启网页动效');
  toggle.setAttribute('aria-pressed', String(enabled));
  toggle.disabled = reducedMotion.matches;
  if (!enabled) {
    for (const animation of runningAnimations) animation.cancel();
    runningAnimations.clear();
  }
}
toggle.addEventListener('click', () => {
  userAllowsMotion = !userAllowsMotion;
  try {
    localStorage.setItem('aibar-motion', userAllowsMotion ? 'on' : 'off');
  } catch {
    // Preference still applies to this page without persistent storage.
  }
  syncMotionPreference();
});
reducedMotion.addEventListener('change', syncMotionPreference);
syncMotionPreference();
window.addEventListener('scroll', scheduleProgress, { passive: true });
window.addEventListener('resize', scheduleProgress, { passive: true });
updateProgress();

const heroElements = document.querySelectorAll('.hero .eyebrow, .hero h1, .hero-bottom, .hero-orbit, .docs-content > h1');
heroElements.forEach((element, index) => animateEntrance(element, index * 65, 18, 650));
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        animateEntrance(entry.target, 0, 18, 550);
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.12 }
  );
  document
    .querySelectorAll('.section-meta, .desk, .feature-grid article, .steps li, .agent-card, .closing, .docs-content section')
    .forEach((element) => observer.observe(element));
}

let panelAnimation;
document.querySelector('#demo-answer')?.addEventListener('demochange', (event) => {
  panelAnimation?.cancel();
  if (document.documentElement.dataset.motion === 'off' || typeof event.currentTarget.animate !== 'function') return;
  panelAnimation = event.currentTarget.animate(
    [
      { opacity: 0.35, transform: 'translateY(7px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: 260, easing: 'cubic-bezier(.16,1,.3,1)' }
  );
  runningAnimations.add(panelAnimation);
  const currentAnimation = panelAnimation;
  currentAnimation.finished.then(
    () => runningAnimations.delete(currentAnimation),
    () => runningAnimations.delete(currentAnimation)
  );
});
for (const details of document.querySelectorAll('details')) {
  details.addEventListener('toggle', () => {
    if (details.open) {
      const content = details.querySelector('p');
      if (content) animateEntrance(content, 0, 5, 230);
    }
    scheduleProgress();
  });
}
