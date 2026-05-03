/* === EVERTHINGBAGLE — Home Page === */
const Home = {
  async init() {
    await this.loadCurrentUser();
    Storage.initDashboard();
    Storage.refreshDashboard();
    this.initDarkMode();
    this.initLogout();

    const brand = document.querySelector('.brand-name');
    if (brand) {
      brand.style.cursor = 'pointer';
      brand.addEventListener('click', () => Storage.refreshDashboard());
    }
  },

  async loadCurrentUser() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.status === 401) { window.location.href = '/login'; return; }
      const data = await res.json();
      const nameBtn = document.getElementById('btn-profile');
      if (nameBtn) nameBtn.textContent = data.user.displayName || data.user.username;
      if (data.user.role === 'admin') {
        const adminBtn = document.getElementById('btn-admin');
        if (adminBtn) adminBtn.classList.remove('hidden');
      }
    } catch (err) {
      console.error('Auth check failed:', err);
    }
  },

  initDarkMode() {
    if (localStorage.getItem('wms-darkmode') === 'true') document.body.classList.add('dark');
    const btn = document.getElementById('btn-darkmode');
    if (btn) btn.addEventListener('click', () => {
      document.body.classList.toggle('dark');
      localStorage.setItem('wms-darkmode', document.body.classList.contains('dark'));
    });
  },

  initLogout() {
    const btn = document.getElementById('btn-logout');
    if (btn) btn.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    });
  },

};

document.addEventListener('DOMContentLoaded', () => Home.init());
