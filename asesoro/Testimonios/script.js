document.addEventListener('DOMContentLoaded', function () {
    const container = document.getElementById('sts-container');
    if (!container) return;

    const track = container.querySelector('.sts-slider-track');
    const slides = container.querySelectorAll('.sts-card');
    const dotsContainer = document.getElementById('sts-dots');
    const readMoreBtns = container.querySelectorAll('.sts-read-more');
    const prevBtn = container.querySelector('.sts-prev');
    const nextBtn = container.querySelector('.sts-next');

    let currentIndex = 0;
    const totalSlides = slides.length;
    let autoPlayInterval;
    let itemsPerView = 1;

    // --- OPTIMIZACIÓN: Debounce para el resize ---
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(updateItemsPerView, 250);
    });

    function updateItemsPerView() {
        const width = window.innerWidth;
        itemsPerView = (width >= 1024) ? 3 : (width >= 640 ? 2 : 1);
        
        requestAnimationFrame(() => {
            createDots();
            updateSliderPosition();
        });
    }

    // --- EVITAR FORCED REFLOW ---
    // IntersectionObserver para "Ver más"
    if (window.IntersectionObserver) {
        const ro = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const btn = entry.target;
                    const targetId = btn.getAttribute('data-target');
                    if (targetId) {
                        const textContent = document.getElementById(targetId);
                        if (textContent) {
                            requestAnimationFrame(() => {
                                const shouldHide = textContent.scrollHeight <= textContent.clientHeight;
                                btn.style.display = shouldHide ? 'none' : 'inline-flex';
                            });
                        }
                    }
                    ro.unobserve(btn);
                }
            });
        });

        readMoreBtns.forEach(btn => ro.observe(btn));
    } else {
        requestAnimationFrame(() => {
            readMoreBtns.forEach(btn => {
                const targetId = btn.getAttribute('data-target');
                if (targetId) {
                    const textContent = document.getElementById(targetId);
                    if (textContent) {
                        const shouldHide = textContent.scrollHeight <= textContent.clientHeight;
                        btn.style.display = shouldHide ? 'none' : 'inline-flex';
                    }
                }
            });
        });
    }

    function updateSliderPosition() {
        if (totalSlides === 0) return;
        const slideWidth = 100 / itemsPerView;
        const maxIndex = Math.max(0, totalSlides - itemsPerView);
        if (currentIndex > maxIndex) currentIndex = maxIndex;
        // Batch DOM Updates
        track.style.transform = `translateX(${-currentIndex * slideWidth}%)`;
        updateDots();
    }

    function createDots() {
        if (!dotsContainer) return;
        dotsContainer.innerHTML = '';
        const dotsCount = Math.max(0, totalSlides - itemsPerView + 1);
        if (dotsCount <= 1) return;

        const fragment = document.createDocumentFragment();
        for (let i = 0; i < dotsCount; i++) {
            const dot = document.createElement('button');
            dot.className = `sts-dot ${i === currentIndex ? 'active' : ''}`;
            dot.setAttribute('aria-label', `Ir al slide ${i + 1}`);
            dot.onclick = () => { currentIndex = i; updateSliderPosition(); resetTimer(); };
            fragment.appendChild(dot);
        }
        dotsContainer.appendChild(fragment);
    }

    function updateDots() {
        if (!dotsContainer) return;
        const dots = dotsContainer.querySelectorAll('.sts-dot');
        dots.forEach((dot, i) => dot.classList.toggle('active', i === currentIndex));
    }

    function moveSlide(direction) {
        const maxIndex = Math.max(0, totalSlides - itemsPerView);
        currentIndex += direction;
        if (currentIndex > maxIndex) currentIndex = 0;
        else if (currentIndex < 0) currentIndex = maxIndex;
        updateSliderPosition();
    }

    // Botones Prev/Next (Reparación del slider pegado)
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            moveSlide(-1);
            resetTimer();
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            moveSlide(1);
            resetTimer();
        });
    }

    // Expansión del texto
    readMoreBtns.forEach(btn => {
        btn.onclick = function() {
            const targetId = this.getAttribute('data-target');
            if (targetId) {
                const target = document.getElementById(targetId);
                if (target) {
                    const isExpanded = target.classList.toggle('expanded');
                    this.textContent = isExpanded ? "Ver menos" : "Ver más";
                    isExpanded ? stopAutoPlay() : startAutoPlay();
                }
            }
        };
    });

    function startAutoPlay() {
        stopAutoPlay();
        if (totalSlides > itemsPerView) autoPlayInterval = setInterval(() => moveSlide(1), 6000);
    }
    function stopAutoPlay() { clearInterval(autoPlayInterval); }
    function resetTimer() { stopAutoPlay(); startAutoPlay(); }

    container.onmouseenter = stopAutoPlay;
    container.onmouseleave = startAutoPlay;

    // Inicializar
    updateItemsPerView();
    startAutoPlay();
});