// frontend/js/workspace/cloud.js
window.OmniWorkspaceCloud = (() => {
    async function syncToCloud(projectId, dataType, payload, options = {}) {
        let toast = null;
        if (!options.silent) {
            toast = document.createElement('div');
            toast.className = "fixed top-5 right-5 bg-blue-900/95 border border-blue-400 text-blue-100 px-5 py-3 rounded-xl shadow-[0_0_20px_rgba(59,130,246,0.6)] flex items-center z-[10000] transition-all duration-500 translate-x-32 opacity-0";
            toast.innerHTML = `<i data-lucide="cloud-upload" class="w-5 h-5 mr-3 animate-bounce"></i> <div><div class="font-bold text-sm">云端神经元同步</div><div class="text-xs text-blue-300">[${dataType}] 同步中...</div></div>`;
            document.body.appendChild(toast);
            if(window.lucide) lucide.createIcons();
            setTimeout(() => toast.classList.remove('translate-x-32', 'opacity-0'), 50);
        }

        try {
            const res = await fetch('/api/workspace/cloud-sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, type: dataType, data: payload })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `同步失败: ${res.status}`);
            }
            if (toast) toast.querySelector('.text-xs').innerText = `[${dataType}] 已同步`;
        } catch(e) {
            console.log("云端同步通道暂时离线，已在本地持久化。");
            if (toast) toast.querySelector('.text-xs').innerText = `[${dataType}] 云端未同步`;
        }

        if (toast) {
            setTimeout(() => {
                toast.classList.add('translate-x-32', 'opacity-0');
                setTimeout(() => toast.remove(), 500);
            }, 3500);
        }
    }

    return {
        syncToCloud
    };
})();
