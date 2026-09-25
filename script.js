(() => {
  // Current year in the footer.
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  // Old section addresses (shared before the redesign) land on the matching
  // new place instead of the top of the page.
  const OLD_FRAGMENTS = { about: "how-i-test", experience: "content", projects: "work", skills: "at-a-glance" };
  const hash = location.hash.slice(1);
  if (Object.prototype.hasOwnProperty.call(OLD_FRAGMENTS, hash) && !document.getElementById(hash)) {
    const target = document.getElementById(OLD_FRAGMENTS[hash]);
    if (target) {
      history.replaceState(null, "", `#${OLD_FRAGMENTS[hash]}`);
      target.scrollIntoView();
    }
  }

  // Highlight the nav link of the section being read. Home page only: there
  // every nav link is an in-page anchor. On case pages build.js marks Work.
  const links = [...document.querySelectorAll(".nav-links a")];
  const onHome = links.length > 0 && links.every((a) => a.getAttribute("href").startsWith("#"));
  if (onHome) {
    const pairs = links
      .map((a) => [a, document.getElementById(a.getAttribute("href").slice(1))])
      .filter(([, el]) => el);
    let lockedUntil = 0;
    let queued = false;
    const setActive = (current) => links.forEach((a) => a.classList.toggle("active", a === current));
    const atBottom = () =>
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    const update = () => {
      queued = false;
      if (Date.now() < lockedUntil) return;
      let current = null;
      // On tall screens the last section never reaches the reading line.
      if (atBottom() && window.scrollY > 0) current = links[links.length - 1];
      else
        for (const [a, el] of pairs)
          if (el.getBoundingClientRect().top <= window.innerHeight * 0.4) current = a;
      setActive(current);
    };
    window.addEventListener(
      "scroll",
      () => {
        if (!queued) {
          queued = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true }
    );
    // A clicked link is marked at once and kept while the page scrolls to it.
    links.forEach((a) =>
      a.addEventListener("click", () => {
        setActive(a);
        lockedUntil = Date.now() + 900;
      })
    );
    update();
  }

  // Copy button next to the email address. Hidden without JavaScript. If the
  // clipboard is unavailable or refused, the address is selected instead.
  const copyBtn = document.querySelector(".copy-btn");
  if (copyBtn) {
    const row = copyBtn.parentElement;
    const status = row.querySelector(".copy-status");
    const address = row.querySelector(".glance-address");
    let timer;
    const say = (text, ms) => {
      clearTimeout(timer);
      status.textContent = text;
      if (ms) timer = setTimeout(() => (status.textContent = ""), ms);
    };
    copyBtn.hidden = false;
    copyBtn.addEventListener("click", async () => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("no clipboard");
        await navigator.clipboard.writeText(copyBtn.dataset.copy);
        say(copyBtn.dataset.done, 3000);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(address);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        say(copyBtn.dataset.fallback);
      }
    });
  }
})();
