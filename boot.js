/* Zaytoon Restaurant — tiny start-up file (loaded in <head>, before the page draws).
   Marks that JavaScript is running, so scroll-reveal styles only apply when they
   can be undone. It is a separate file (not inline) so a strict
   Content-Security-Policy (script-src 'self') can be used — see _headers. */
document.documentElement.classList.add('js');
