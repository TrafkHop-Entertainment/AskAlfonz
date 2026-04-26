function loadComponent(elementId, filePath, callback) {
    fetch(filePath)
    .then(response => {
        if (!response.ok) throw new Error('Komponente nicht gefunden');
        return response.text();
    })
    .then(data => {
        document.getElementById(elementId).innerHTML = data;

        if (callback) {
            callback();
        }
    })
    .catch(error => console.error('Fehler beim Laden von ' + filePath, error));
}

loadComponent('header-placeholder', 'files/header.html');

loadComponent('nav-placeholder', 'files/nav.html', () => {
    if (typeof initNav === 'function') {
        initNav();
    }
});

loadComponent('footer-placeholder', 'files/footer.html');

/*Made with AI*/