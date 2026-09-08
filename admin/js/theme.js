/**
 * WhatsApp Gateway Admin - Centralized Theme Management
 * Ensures seamless dark/light mode persistence, zero-flash navigation,
 * cross-tab synchronization, and unified toggle buttons across all pages.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'app-theme';

    function getStoredTheme() {
        try {
            return localStorage.getItem(STORAGE_KEY) || 'light';
        } catch (e) {
            return 'light';
        }
    }

    function applyTheme(theme) {
        const safeTheme = theme === 'dark' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-bs-theme', safeTheme);
        updateToggleButtons(safeTheme);
    }

    function updateToggleButtons(theme) {
        const isDark = theme === 'dark';
        const titleText = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';

        // Handle sidebar footer theme toggle (#theme-toggler)
        const sidebarToggler = document.getElementById('theme-toggler');
        if (sidebarToggler) {
            sidebarToggler.setAttribute('title', titleText);
            sidebarToggler.setAttribute('aria-label', titleText);
            const darkSpan = sidebarToggler.querySelector('.theme-icon-dark');
            const lightSpan = sidebarToggler.querySelector('.theme-icon-light');
            if (!darkSpan || !lightSpan) {
                sidebarToggler.innerHTML = isDark
                    ? '<i class="bi bi-sun-fill text-warning me-1"></i> Light'
                    : '<i class="bi bi-moon-stars-fill text-info me-1"></i> Dark';
            }
        }

        // Handle standalone login page toggle (#themeToggler)
        const loginToggler = document.getElementById('themeToggler');
        if (loginToggler) {
            loginToggler.setAttribute('title', titleText);
            loginToggler.setAttribute('aria-label', titleText);
            const darkSpan = loginToggler.querySelector('.theme-icon-dark');
            const lightSpan = loginToggler.querySelector('.theme-icon-light');
            if (!darkSpan || !lightSpan) {
                loginToggler.innerHTML = isDark
                    ? '<i class="bi bi-sun-fill text-warning"></i>'
                    : '<i class="bi bi-moon-stars-fill text-info"></i>';
            }
        }
    }

    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-bs-theme') || 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        try {
            localStorage.setItem(STORAGE_KEY, newTheme);
        } catch (e) {}
        applyTheme(newTheme);
    }

    // Expose on window
    window.applyTheme = applyTheme;
    window.toggleTheme = toggleTheme;
    window.initTheme = function () {
        applyTheme(getStoredTheme());
    };

    // Apply immediately to prevent any styling delay
    applyTheme(getStoredTheme());

    // Bind event listeners once DOM is ready
    function setupThemeListeners() {
        applyTheme(getStoredTheme());

        const sidebarToggler = document.getElementById('theme-toggler');
        if (sidebarToggler && !sidebarToggler._themeBound) {
            sidebarToggler._themeBound = true;
            sidebarToggler.addEventListener('click', toggleTheme);
        }

        const loginToggler = document.getElementById('themeToggler');
        if (loginToggler && !loginToggler._themeBound) {
            loginToggler._themeBound = true;
            loginToggler.addEventListener('click', toggleTheme);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupThemeListeners);
    } else {
        setupThemeListeners();
    }

    // Cross-tab synchronization
    window.addEventListener('storage', function (e) {
        if (e.key === STORAGE_KEY && e.newValue) {
            applyTheme(e.newValue);
        }
    });
})();
