// Año dinámico en el footer
document.getElementById("year").textContent = new Date().getFullYear();

// Efecto de tecleo del comando del hero (se omite con reduced-motion o sin JS)
const typed = document.getElementById("typed");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (typed && !reduceMotion) {
  const text = typed.textContent;
  typed.textContent = "";
  let i = 0;
  const timer = setInterval(() => {
    typed.textContent = text.slice(0, ++i);
    if (i >= text.length) clearInterval(timer);
  }, 95);
}

// Resaltar el enlace de navegación de la sección visible
const sections = document.querySelectorAll("section[id]");
const navLinks = document.querySelectorAll(".nav-links a");

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        navLinks.forEach((link) => {
          link.classList.toggle(
            "active",
            link.getAttribute("href") === `#${entry.target.id}`
          );
        });
      }
    });
  },
  { rootMargin: "-40% 0px -55% 0px" }
);

sections.forEach((section) => observer.observe(section));
