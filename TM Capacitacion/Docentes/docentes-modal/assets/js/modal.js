document.addEventListener('DOMContentLoaded', function () {
	const triggers = document.querySelectorAll('.dm-trigger');
	const overlay = document.getElementById('dm-modal-overlay');

	if (!overlay) return;

	const modal = overlay.querySelector('.dm-modal');
	const titleEl = document.getElementById('dm-modal-title');
	const contentEl = document.getElementById('dm-modal-content');
	const spinner = overlay.querySelector('.dm-spinner');
	const closeBtns = overlay.querySelectorAll('.dm-modal__close-icon, .dm-modal__close-btn');

	let previousActiveElement;

	// Event Delegation for dynamically added cards (optional, or just bind to existing)
	// Triggers might be added dynamically if using load more, but for now we stick to static binding or re-binding.
	// Since the shortcode renders PHP, elements are there on load.
	triggers.forEach(trigger => {
		trigger.addEventListener('click', function () {
			const postId = this.getAttribute('data-id');
			openModal(postId);
		});
	});

	function openModal(id) {
		previousActiveElement = document.activeElement;

		// Reset Content
		titleEl.textContent = '';
		contentEl.innerHTML = '';
		spinner.classList.add('is-active');

		// Show overlay
		overlay.ariaHidden = 'false';
		overlay.classList.add('is-visible');

		// Focus Trap init
		modal.focus();

		// Fetch Data
		fetch(`${DocentesModalData.root_url}wp/v2/docente/${id}?_fields=title,content,excerpt,featured_image_src,cargo,tags_list&_nonce=${DocentesModalData.nonce}`)
			.then(response => {
				if (!response.ok) throw new Error('API Error');
				return response.json();
			})
			.then(data => {
				spinner.classList.remove('is-active');
				renderModalContent(data);
			})
			.catch(err => {
				spinner.classList.remove('is-active');
				contentEl.innerHTML = '<p style="text-align:center; padding:20px; color:#ef4444;">Error al cargar el perfil del docente.</p>';
				console.error(err);
			});
	}

	function renderModalContent(data) {
		// Set Header Title
		titleEl.textContent = data.title.rendered;

		// --- PREPARE DATA ---

		// Image
		const imgSrc = data.featured_image_src || '';
		const imageHTML = imgSrc
			? `<img src="${imgSrc}" alt="${data.title.rendered}" class="dm-modal__photo">`
			: `<div class="dm-modal__photo-placeholder">${getInitials(data.title.rendered)}</div>`;

		// Bio (Excerpt)
		const bioHTML = data.excerpt.rendered;

		// Cargo
		const cargoHTML = data.cargo ? `<div class="dm-modal__cargo">${data.cargo}</div>` : '';

		// Tags (Optional in modal, but good to have)
		let tagsHTML = '';
		if (data.tags_list && data.tags_list.length > 0) {
			tagsHTML = `<div class="dm-modal__tags">
				${data.tags_list.map(tag => `<span class="dm-tag">${tag.name}</span>`).join('')}
			</div>`;
		}

		// Main Content (Courses/Gallery from Block Editor)
		const fullContentHTML = data.content.rendered;

		// --- BUILD 3-QUADRANT LAYOUT ---

		/*
		Structure:
		.dm-modal__grid
			.dm-modal__left (Image)
			.dm-modal__right (Bio + Cargo + Tags)
			.dm-modal__bottom (Full Content)
		*/

		contentEl.innerHTML = `
			<div class="dm-modal__grid">
				<!-- Quadrant 1: Left (Image) -->
				<div class="dm-modal__left">
					${imageHTML}
				</div>

				<!-- Quadrant 2: Right (Bio Info) -->
				<div class="dm-modal__right">
					${cargoHTML}
					<div class="dm-modal__bio">${bioHTML}</div>
					${tagsHTML}
				</div>

				<!-- Quadrant 3: Bottom (Full Content) -->
				<div class="dm-modal__bottom">
					${fullContentHTML}
				</div>
			</div>
		`;
	}

	function getInitials(name) {
		return name
			.split(' ')
			.map(n => n[0])
			.join('')
			.toUpperCase()
			.substring(0, 2);
	}

	// Close Modal Functions
	function closeModal() {
		overlay.classList.remove('is-visible');
		overlay.ariaHidden = 'true';
		if (previousActiveElement) previousActiveElement.focus();
	}

	// Close events
	closeBtns.forEach(btn => {
		btn.addEventListener('click', closeModal);
	});

	overlay.addEventListener('click', function (e) {
		if (e.target === overlay) closeModal();
	});

	document.addEventListener('keydown', function (e) {
		if (!overlay.classList.contains('is-visible')) return;

		if (e.key === 'Escape') {
			closeModal();
		}

		// Focus Trap (Simple version)
		if (e.key === 'Tab') {
			const focusableElements = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
			if (focusableElements.length === 0) return;

			const firstElement = focusableElements[0];
			const lastElement = focusableElements[focusableElements.length - 1];

			if (e.shiftKey) { /* shift + tab */
				if (document.activeElement === firstElement) {
					lastElement.focus();
					e.preventDefault();
				}
			} else { /* tab */
				if (document.activeElement === lastElement) {
					firstElement.focus();
					e.preventDefault();
				}
			}
		}
	});
});
