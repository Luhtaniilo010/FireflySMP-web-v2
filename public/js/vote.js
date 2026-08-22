(() => {
  const slides = [...document.querySelectorAll(".vote-showcase-slide")];
  const dots = [...document.querySelectorAll(".vote-showcase-dots span")];
  if (slides.length < 2) return;

  let index = 0;
  setInterval(() => {
    slides[index].classList.remove("active");
    dots[index]?.classList.remove("active");
    index = (index + 1) % slides.length;
    slides[index].classList.add("active");
    dots[index]?.classList.add("active");
  }, 5200);
})();
