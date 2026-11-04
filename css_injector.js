(function() {
    if (window.location.hostname.includes("missav")) {
        const style = document.createElement('style');
        style.textContent = `
            .my-2.text-sm.text-nord4.truncate {
                white-space: normal !important;
                overflow: visible !important;
                text-overflow: unset !important;
            }
            .root--26nWL.bottomRight--h0VsQ {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
        console.log("Injected CSS override and ad blocker for missav");
    }
})();
