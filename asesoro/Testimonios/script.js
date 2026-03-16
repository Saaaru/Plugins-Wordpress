document.addEventListener('DOMContentLoaded', function () {
    const container = document.getElementById('sts-container');
    if (!container) return;

    const track = container.querySelector('.sts-slider-track');
    const slides = container.querySelectorAll('.sts-card');
    const dotsContainer = document.getElementById('sts-dots');
    const readMoreBtns = container.querySelectorAll('.sts-read-more');

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
        
        // Usamos requestAnimationFrame para evitar Forced Reflow
        requestAnimationFrame(() => {
            createDots();
            updateSliderPosition();
            checkReadMoreButtons();
        });
    }

    function checkReadMoreButtons() {
        // BATCH READING: Leemos todas las medidas primero
        const tasks = Array.from(readMoreBtns).map(btn => {
            const textContent = document.getElementById(btn.getAttribute('data-target'));
            return {
                btn,
                shouldHide: textContent.scrollHeight <= textContent.clientHeight
            };
        });

        // BATCH WRITING: Aplicamos los cambios de estilo juntos
        tasks.forEach(task => {
            task.btn.style.display = task.shouldHide ? 'none' : 'inline-flex';
        });
    }

    function updateSliderPosition() {
        const slideWidth = 100 / itemsPerView;
        const maxIndex = Math.max(0, totalSlides - itemsPerView);
        if (currentIndex > maxIndex) currentIndex = maxIndex;
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

    // Eventos y Autoplay (Simplificado)
    readMoreBtns.forEach(btn => {
        btn.onclick = function() {
            const target = document.getElementById(this.getAttribute('data-target'));
            const isExpanded = target.classList.toggle('expanded');
            this.textContent = isExpanded ? "Ver menos" : "Ver más";
            isExpanded ? stopAutoPlay() : startAutoPlay();
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