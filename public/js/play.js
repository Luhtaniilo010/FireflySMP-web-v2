(() => {
  const IP = "fireflysmp.net";

  async function copyIp() {
    try {
      await navigator.clipboard.writeText(IP);
    } catch {
      const area = document.createElement("textarea");
      area.value = IP;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }

    const hint = document.querySelector(".server-copy-hint");
    if (hint) {
      hint.textContent = "COPIED!";
      hint.style.opacity = "1";
      setTimeout(() => hint.textContent = "CLICK TO COPY", 1300);
    }
  }

  document.getElementById("serverCopy")?.addEventListener("click", copyIp);
  document.getElementById("bigIp")?.addEventListener("click", copyIp);

  async function updateStatus() {
    const badge = document.getElementById("onlineBadge");
    if (!badge) return;

    try {
      const response = await fetch("https://api.mcsrvstat.us/3/fireflysmp.net:25677", { cache: "no-store" });
      const data = await response.json();
      badge.textContent =
        data?.online && Number.isFinite(data?.players?.online)
          ? `${data.players.online} ONLINE`
          : "OFFLINE";
    } catch {
      badge.textContent = "STATUS";
    }
  }

  updateStatus();
  setInterval(updateStatus, 30_000);

  const typedIp = document.getElementById("typedServerIp");

  function typeServerAddress() {
    if (!typedIp) return;

    const value = typedIp.dataset.value || "fireflysmp.net";
    let index = 0;
    let deleting = false;

    function tick() {
      if (!deleting) {
        index++;
        typedIp.textContent = value.slice(0, index);

        if (index >= value.length) {
          deleting = true;
          setTimeout(tick, 2600);
          return;
        }

        setTimeout(tick, 95);
      } else {
        index--;
        typedIp.textContent = value.slice(0, index);

        if (index <= 0) {
          deleting = false;
          setTimeout(tick, 550);
          return;
        }

        setTimeout(tick, 48);
      }
    }

    typedIp.textContent = "";
    setTimeout(tick, 500);
  }

  typeServerAddress();
})();
