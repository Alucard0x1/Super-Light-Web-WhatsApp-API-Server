/**
 * Reusable Non-Blocking Toast Notification System
 * Replaces disruptive window.alert() calls with sleek, modern UI toasts.
 */
(function () {
    // Ensure styles are injected
    const styleId = 'custom-toast-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            #custom-toast-container {
                position: fixed;
                top: 1.25rem;
                right: 1.25rem;
                z-index: 10999;
                display: flex;
                flex-direction: column;
                gap: 0.6rem;
                max-width: 380px;
                width: calc(100vw - 2.5rem);
                pointer-events: none;
            }
            .custom-toast {
                pointer-events: auto;
                display: flex;
                align-items: flex-start;
                gap: 0.75rem;
                padding: 0.85rem 1rem;
                border-radius: 12px;
                background-color: var(--bg-card, #ffffff);
                color: var(--bs-body-color, #1e293b);
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
                border: 1px solid var(--border-card, #e2e8f0);
                font-family: var(--font-main, system-ui, -apple-system, sans-serif);
                font-size: 0.88rem;
                line-height: 1.4;
                opacity: 0;
                transform: translateX(30px);
                transition: opacity 0.25s ease, transform 0.25s ease;
            }
            .custom-toast.show {
                opacity: 1;
                transform: translateX(0);
            }
            .custom-toast-icon {
                font-size: 1.15rem;
                flex-shrink: 0;
                line-height: 1;
                margin-top: 1px;
            }
            .custom-toast-content {
                flex-grow: 1;
                word-break: break-word;
            }
            .custom-toast-close {
                background: transparent;
                border: none;
                color: #94a3b8;
                font-size: 0.85rem;
                cursor: pointer;
                padding: 0;
                margin-left: 0.25rem;
                line-height: 1;
                opacity: 0.7;
                transition: opacity 0.15s;
            }
            .custom-toast-close:hover {
                opacity: 1;
                color: inherit;
            }
            .custom-toast-success {
                border-left: 4px solid #10b981;
            }
            .custom-toast-success .custom-toast-icon {
                color: #10b981;
            }
            .custom-toast-error, .custom-toast-danger {
                border-left: 4px solid #ef4444;
            }
            .custom-toast-error .custom-toast-icon, .custom-toast-danger .custom-toast-icon {
                color: #ef4444;
            }
            .custom-toast-warning {
                border-left: 4px solid #f59e0b;
            }
            .custom-toast-warning .custom-toast-icon {
                color: #f59e0b;
            }
            .custom-toast-info {
                border-left: 4px solid #3b82f6;
            }
            .custom-toast-info .custom-toast-icon {
                color: #3b82f6;
            }
            [data-bs-theme="dark"] .custom-toast {
                background-color: #151c2c;
                border-color: #1e293b;
                color: #f1f5f9;
            }
        `;
        document.head.appendChild(style);
    }

    function getContainer() {
        let container = document.getElementById('custom-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'custom-toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    const icons = {
        success: 'bi-check-circle-fill',
        error: 'bi-x-circle-fill',
        danger: 'bi-exclamation-triangle-fill',
        warning: 'bi-exclamation-circle-fill',
        info: 'bi-info-circle-fill'
    };

    function showToast(message, type = 'info', duration = 3500) {
        const container = getContainer();
        const toast = document.createElement('div');
        const safeType = icons[type] ? type : 'info';
        const iconClass = icons[safeType];

        toast.className = `custom-toast custom-toast-${safeType}`;
        toast.innerHTML = `
            <i class="bi ${iconClass} custom-toast-icon"></i>
            <div class="custom-toast-content">${escapeText(message)}</div>
            <button type="button" class="custom-toast-close" title="Close"><i class="bi bi-x-lg"></i></button>
        `;

        const closeBtn = toast.querySelector('.custom-toast-close');
        const dismiss = () => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 250);
        };

        closeBtn.addEventListener('click', dismiss);

        container.appendChild(toast);
        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        if (duration > 0) {
            setTimeout(dismiss, duration);
        }
        return toast;
    }

    function escapeText(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    window.showToast = showToast;

    // Gracefully override window.alert so any third-party or residual alerts render as nice toasts
    window.alert = function (msg) {
        if (!msg) return;
        const str = String(msg);
        let type = 'info';
        if (/error|fail|cannot|invalid|denied/i.test(str)) {
            type = 'error';
        } else if (/success|sent|connected|saved|deleted/i.test(str)) {
            type = 'success';
        } else if (/warn|select|required|check|please/i.test(str)) {
            type = 'warning';
        }
        showToast(str, type, 4000);
    };
})();
