document.addEventListener('DOMContentLoaded', function () {
    const container = document.getElementById('sts-container');
    if (!container) return;

    const track = container.querySelector('.sts-slider-track');
    const slides = container.querySelectorAll('.sts-card');
    const prevBtn = container.querySelector('.sts-prev');
    const nextBtn = container.querySelector('.sts-next');
    const dotsContainer = document.getElementById('sts-dots');

    let currentIndex = 0;
    const totalSlides = slides.length;
    let autoPlayInterval;
    let itemsPerView = 1;

    // --- 1. CALCULAR CUÁNTOS SE VEN ---
    function updateItemsPerView() {
        const width = window.innerWidth;
        if (width >= 1024) {
            itemsPerView = 3;
        } else if (width >= 640) {
            itemsPerView = 2;
        } else {
            itemsPerView = 1;
        }
        createDots();
        updateSliderPosition();
        checkReadMoreButtons();
    }

    // --- 2. GENERAR PUNTOS ---
    function createDots() {
        if (!dotsContainer) return;
        dotsContainer.innerHTML = '';
        const dotsCount = Math.max(0, totalSlides - itemsPerView + 1);

        if (dotsCount <= 1) return; // No mostrar si solo hay un grupo

        for (let i = 0; i < dotsCount; i++) {
            const dot = document.createElement('button');
            dot.classList.add('sts-dot');
            dot.setAttribute('aria-label', `Ir al slide ${i + 1}`);
            if (i === currentIndex) dot.classList.add('active');

            dot.addEventListener('click', () => {
                currentIndex = i;
                updateSliderPosition();
                resetTimer();
            });

            dotsContainer.appendChild(dot);
        }
    }

    function updateDots() {
        if (!dotsContainer) return;
        const dots = dotsContainer.querySelectorAll('.sts-dot');
        dots.forEach((dot, index) => {
            if (index === currentIndex) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
    }

    // --- 3. MOVER SLIDER ---
    function updateSliderPosition() {
        const slideWidth = 100 / itemsPerView;
        const maxIndex = Math.max(0, totalSlides - itemsPerView);

        // Corregir índice si está fuera de rango tras resize
        if (currentIndex > maxIndex) currentIndex = maxIndex;

        const translateX = -(currentIndex * slideWidth);
        track.style.transform = `translateX(${translateX}%)`;
        updateDots();
    }

    function moveSlide(direction) {
        const maxIndex = Math.max(0, totalSlides - itemsPerView);
        currentIndex += direction;

        if (currentIndex > maxIndex) {
            currentIndex = 0;
        } else if (currentIndex < 0) {
            currentIndex = maxIndex;
        }

        updateSliderPosition();
    }

    // --- 4. SMART READ MORE ---
    function checkReadMoreButtons() {
        const readMoreBtns = container.querySelectorAll('.sts-read-more');
        readMoreBtns.forEach(btn => {
            const targetId = btn.getAttribute('data-target');
            const textContent = document.getElementById(targetId);

            // Si el contenido no desborda, ocultamos el botón
            if (textContent.scrollHeight <= textContent.clientHeight) {
                btn.style.display = 'none';
            } else {
                btn.style.display = 'inline-flex';
            }
        });
    }

    // Eventos de botones Read More
    const readMoreBtns = container.querySelectorAll('.sts-read-more');
    readMoreBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            const targetId = this.getAttribute('data-target');
            const textContent = document.getElementById(targetId);
            textContent.classList.toggle('expanded');

            if (textContent.classList.contains('expanded')) {
                this.textContent = "Ver menos";
                stopAutoPlay();
            } else {
                this.textContent = "Ver más";
                startAutoPlay();
            }
        });
    });

    // --- 5. TOUCH SUPPORT (SWIPE) ---
    let touchStartX = 0;
    let touchEndX = 0;

    track.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        stopAutoPlay();
    }, { passive: true });

    track.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
        startAutoPlay();
    }, { passive: true });

    function handleSwipe() {
        const swipeThreshold = 50;
        if (touchStartX - touchEndX > swipeThreshold) {
            moveSlide(1); // Swipe left -> Next
        } else if (touchEndX - touchStartX > swipeThreshold) {
            moveSlide(-1); // Swipe right -> Prev
        }
    }

    // --- 6. EVENTOS GENERALES ---
    window.addEventListener('resize', updateItemsPerView);

    if (nextBtn) nextBtn.addEventListener('click', () => {
        moveSlide(1);
        resetTimer();
    });

    if (prevBtn) prevBtn.addEventListener('click', () => {
        moveSlide(-1);
        resetTimer();
    });

    // Autoplay
    function startAutoPlay() {
        stopAutoPlay();
        if (totalSlides > itemsPerView) {
            autoPlayInterval = setInterval(() => {
                moveSlide(1);
            }, 6000);
        }
    }

    function stopAutoPlay() {
        if (autoPlayInterval) clearInterval(autoPlayInterval);
    }

    function resetTimer() {
        stopAutoPlay();
        startAutoPlay();
    }

    container.addEventListener('mouseenter', stopAutoPlay);
    container.addEventListener('mouseleave', startAutoPlay);

    // Inicializar
    updateItemsPerView();
    startAutoPlay();
});