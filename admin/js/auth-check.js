// Authentication check module
(function() {
    // Check if user is authenticated
    async function checkAuthentication() {
        try {
            const response = await fetch('/api/v1/me');
            if (!response.ok) {
                throw new Error('Not authenticated');
            }
            return await response.json();
        } catch (error) {
            window.location.href = '/admin/login.html';
            throw error;
        }
    }

    // Make it available globally
    window.checkAuthentication = checkAuthentication;
})(); 