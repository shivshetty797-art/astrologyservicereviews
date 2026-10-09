document.addEventListener('DOMContentLoaded', function () {
    // Mobile menu toggle
    var toggle = document.querySelector('.menu-toggle');
    var nav = document.querySelector('.main-nav');
    var openIcon = document.querySelector('.menu-toggle__open');
    var closeIcon = document.querySelector('.menu-toggle__close');

    if (toggle && nav) {
        toggle.addEventListener('click', function () {
            var expanded = nav.classList.toggle('active');
            toggle.setAttribute('aria-expanded', expanded);
            if (openIcon) openIcon.style.display = expanded ? 'none' : 'block';
            if (closeIcon) closeIcon.style.display = expanded ? 'block' : 'none';
        });
    }

    // FAQ accordion
    var faqItems = document.querySelectorAll('.faq-item__question');
    faqItems.forEach(function (btn) {
        btn.addEventListener('click', function () {
            var item = btn.closest('.faq-item');
            var isActive = item.classList.contains('active');

            // Close all
            document.querySelectorAll('.faq-item').forEach(function (el) {
                el.classList.remove('active');
                el.querySelector('.faq-item__question').setAttribute('aria-expanded', 'false');
            });

            // Open clicked if it was closed
            if (!isActive) {
                item.classList.add('active');
                btn.setAttribute('aria-expanded', 'true');
            }
        });
    });
});
