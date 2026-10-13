/**
 * Presentation Mode — adapted for Centralize-SOM Weekly Report
 */

class PresentationMode {
  constructor(dashboard) {
    this.dashboard = dashboard;
    this.isActive = false;
    this.currentSlide = 0;
    this.slides = [];
    this.keyboardHandler = null;
    this.mouseMoveHandler = null;
    this.laserActive = false;
  }

  enter() {
    if (this.isActive) return;

    this.isActive = true;
    document.body.classList.add('presentation-mode');
    this.createPresentationOverlay();
    this.setupSlides();
    this.showSlide(0);
    this.setupKeyboardNavigation();
  }

  exit() {
    if (!this.isActive) return;

    this.isActive = false;
    document.body.classList.remove('presentation-mode');

    const overlay = document.getElementById('presentationOverlay');
    if (overlay) overlay.remove();

    const laser = document.getElementById('laserPointer');
    if (laser) laser.remove();

    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler);
    }
    if (this.mouseMoveHandler) {
      document.removeEventListener('mousemove', this.mouseMoveHandler);
    }

    document.body.style.cursor = '';
    this.slides = [];
    this.currentSlide = 0;
    this.laserActive = false;
  }

  createPresentationOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'presentationOverlay';
    overlay.className = 'presentation-overlay';

    overlay.innerHTML = `
      <div class="presentation-header">
        <div class="presentation-title">
          <span style="font-size:16px;">🎥</span>
          <div>
            <h1>Presentation Mode</h1>
            <p>${WeeklyDateUtils.formatWeekRange(this.dashboard.currentWeek)}</p>
          </div>
        </div>
        <div class="presentation-controls">
          <button class="pres-btn" id="presPrev" title="Previous (←)"><i data-icon="chevron-left"></i> Prev</button>
          <span class="pres-counter" id="presCounter">1 / 1</span>
          <button class="pres-btn" id="presNext" title="Next (→)">Next <i data-icon="play"></i></button>
          <button class="pres-btn" id="presFullscreen" title="Fullscreen (F)"><i data-icon="maximize"></i></button>
          <button class="pres-btn" id="presLaser" title="Laser Pointer (L)"><i data-icon="circle"></i></button>
          <button class="pres-btn pres-btn-danger" id="presExit" title="Exit (Esc)"><i data-icon="x"></i></button>
        </div>
      </div>
      <div class="presentation-canvas" id="presentationCanvas">
        <div class="presentation-slides" id="presentationSlides"></div>
      </div>
      <div class="presentation-footer">
        <div class="slide-indicators" id="slideIndicators"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('presExit').addEventListener('click', () => this.exit());
    document.getElementById('presPrev').addEventListener('click', () => this.previousSlide());
    document.getElementById('presNext').addEventListener('click', () => this.nextSlide());
    document.getElementById('presFullscreen').addEventListener('click', () => this.toggleFullscreen());
    document.getElementById('presLaser').addEventListener('click', () => this.toggleLaser());

    this.setupLaserPointer();
  }

  setupSlides() {
    const sourceCards = document.querySelectorAll('.dashboard-grid > .card');

    this.slides.push(this.createOverviewSlide());

    sourceCards.forEach((card, index) => {
      this.slides.push(this.createCardSlide(card, index));
    });

    const container = document.getElementById('presentationSlides');
    this.slides.forEach((slide, index) => {
      slide.dataset.slideIndex = index;
      container.appendChild(slide);
    });

    this.createSlideIndicators();
  }

  createOverviewSlide() {
    const slide = document.createElement('div');
    slide.className = 'pres-slide';

    const statsBar = document.querySelector('.stats-bar');
    const statsClone = statsBar ? statsBar.cloneNode(true) : null;

    slide.innerHTML = `
      <div class="slide-content overview-slide">
        <div class="slide-header">
          <h1><i data-icon="bar-chart"></i> SM Weekly Report</h1>
          <h2>${WeeklyDateUtils.formatWeekRange(this.dashboard.currentWeek)}</h2>
        </div>
        <div class="overview-stats">
          ${statsClone ? statsClone.outerHTML : '<p>No stats available</p>'}
        </div>
        <div class="overview-summary">
          <div class="summary-card"><span class="summary-icon"><i data-icon="alert-triangle"></i></span><div class="summary-text"><h3>Incidents</h3><p>System incidents detected by SM</p></div></div>
          <div class="summary-card"><span class="summary-icon"><i data-icon="bell"></i></span><div class="summary-text"><h3>Updates & Alerts</h3><p>System updates and notifications</p></div></div>
          <div class="summary-card"><span class="summary-icon"><i data-icon="users"></i></span><div class="summary-text"><h3>Support Tasks</h3><p>MA & Dev support tasks</p></div></div>
          <div class="summary-card"><span class="summary-icon"><i data-icon="package"></i></span><div class="summary-text"><h3>Batch Operations</h3><p>Batch events and pending issues</p></div></div>
          <div class="summary-card"><span class="summary-icon"><i data-icon="rocket"></i></span><div class="summary-text"><h3>Improvements</h3><p>System enhancements and projects</p></div></div>
        </div>
      </div>
    `;
    return slide;
  }

  createCardSlide(sourceCard, index) {
    const slide = document.createElement('div');
    slide.className = 'pres-slide';

    const header = sourceCard.querySelector('.card-header');
    const body = sourceCard.querySelector('.card-body');
    const badge = sourceCard.querySelector('.card-badge');

    const titleEl = header ? header.querySelector('h2, .card-title') : null;
    const iconEl = header ? header.querySelector('.card-icon') : null;
    const title = titleEl ? titleEl.textContent.trim() : `Card ${index + 1}`;
    const icon = iconEl ? iconEl.innerHTML.trim() : '<i data-icon="clipboard"></i>';
    const count = badge ? badge.textContent.trim() : '0';

    slide.innerHTML = `
      <div class="slide-content card-slide">
        <div class="slide-header">
          <span class="slide-icon">${icon}</span>
          <div>
            <h1>${title}</h1>
            <p class="slide-count">${count} items</p>
          </div>
        </div>
        <div class="slide-body">
          ${body ? body.innerHTML : '<p>No content</p>'}
        </div>
      </div>
    `;
    return slide;
  }

  createSlideIndicators() {
    const container = document.getElementById('slideIndicators');
    if (!container) return;
    container.innerHTML = '';

    this.slides.forEach((_, index) => {
      const btn = document.createElement('button');
      btn.className = 'slide-indicator';
      btn.dataset.slideIndex = index;
      btn.title = `Slide ${index + 1}`;
      btn.addEventListener('click', () => this.showSlide(index));
      container.appendChild(btn);
    });
  }

  showSlide(index) {
    if (index < 0 || index >= this.slides.length) return;

    this.currentSlide = index;

    this.slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === index);
    });

    document.querySelectorAll('.slide-indicator').forEach((dot, i) => {
      dot.classList.toggle('active', i === index);
    });

    const counter = document.getElementById('presCounter');
    if (counter) counter.textContent = `${index + 1} / ${this.slides.length}`;

    const prevBtn = document.getElementById('presPrev');
    const nextBtn = document.getElementById('presNext');
    if (prevBtn) prevBtn.disabled = index === 0;
    if (nextBtn) nextBtn.disabled = index === this.slides.length - 1;
  }

  nextSlide() {
    if (this.currentSlide < this.slides.length - 1) this.showSlide(this.currentSlide + 1);
  }

  previousSlide() {
    if (this.currentSlide > 0) this.showSlide(this.currentSlide - 1);
  }

  setupKeyboardNavigation() {
    this.keyboardHandler = (e) => {
      if (!this.isActive) return;
      switch (e.key) {
        case 'ArrowLeft': case 'ArrowUp': this.previousSlide(); e.preventDefault(); break;
        case 'ArrowRight': case 'ArrowDown': case ' ': this.nextSlide(); e.preventDefault(); break;
        case 'Home': this.showSlide(0); e.preventDefault(); break;
        case 'End': this.showSlide(this.slides.length - 1); e.preventDefault(); break;
        case 'Escape': this.exit(); e.preventDefault(); break;
        case 'f': case 'F': this.toggleFullscreen(); e.preventDefault(); break;
        case 'l': case 'L': this.toggleLaser(); e.preventDefault(); break;
      }
    };
    document.addEventListener('keydown', this.keyboardHandler);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  setupLaserPointer() {
    const pointer = document.createElement('div');
    pointer.id = 'laserPointer';
    pointer.className = 'laser-pointer hidden';
    document.body.appendChild(pointer);

    this.mouseMoveHandler = (e) => {
      if (this.laserActive) {
        pointer.style.left = e.clientX + 'px';
        pointer.style.top = e.clientY + 'px';
      }
    };
    document.addEventListener('mousemove', this.mouseMoveHandler);
  }

  toggleLaser() {
    this.laserActive = !this.laserActive;
    const pointer = document.getElementById('laserPointer');
    const btn = document.getElementById('presLaser');

    if (this.laserActive) {
      pointer.classList.remove('hidden');
      btn.classList.add('active');
      document.body.style.cursor = 'none';
    } else {
      pointer.classList.add('hidden');
      btn.classList.remove('active');
      document.body.style.cursor = '';
    }
  }
}
