// First-visit landing. The script runs in <head> before paint, so returning visitors (and anyone
// opening a link that already holds a search) never see the landing flash by.
export const STARTED_KEY = "agentshop:started";

export const STARTED_SCRIPT = `try{if(localStorage.getItem("${STARTED_KEY}")||/[?&]q=/.test(location.search))document.documentElement.setAttribute("data-started","")}catch(e){document.documentElement.setAttribute("data-started","")}`;
