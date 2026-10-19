// Aplica o tema salvo antes do React montar: sem flash branco no escuro.
// Arquivo externo (e não <script> inline) para caber na CSP de produção.
(function () {
  try {
    var t = localStorage.getItem("portal.tema");
    if (t === "claro" || t === "escuro") document.documentElement.setAttribute("data-tema", t);
  } catch (e) {
    /* sem storage: segue o sistema */
  }
})();
