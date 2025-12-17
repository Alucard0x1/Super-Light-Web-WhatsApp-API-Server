// Authentication check module
(function () {
    // Check if user is authenticated
    async function checkAuthentication() {
        try {
            const response = await fetch('/admin/me');
            if (!response.ok) {
                throw new Error('Not authenticated');
            }
            const result = await response.json();
            return result.data;
        } catch (error) {
            window.location.href = '/admin/login.html';
            throw error;
        }
    }

    // Make it available globally
    window.checkAuthentication = checkAuthentication;
})(); 