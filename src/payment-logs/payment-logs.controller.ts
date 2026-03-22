import { Controller, Get, Delete, HttpStatus, HttpException, Header } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Controller('payment-logs')
export class PaymentLogsController {
    private readonly logsPath = path.join(process.cwd(), 'logs', 'combined.log');
    private readonly errorLogsPath = path.join(process.cwd(), 'logs', 'error.log');

    @Get('api/logs')
    getLogs() {
        if (!fs.existsSync(this.logsPath)) {
            return [];
        }

        try {
            const data = fs.readFileSync(this.logsPath, 'utf8');
            // Winston JSON lines
            return data
                .split('\n')
                .filter(line => line.trim().length > 0)
                .map(line => {
                    try {
                        return JSON.parse(line);
                    } catch (e) {
                        return { message: line, level: 'info', timestamp: new Date().toISOString() };
                    }
                })
                .reverse() // Newest first
                .slice(0, 1000); // Limit to last 1000 for safety
        } catch (error) {
            throw new HttpException('Failed to read logs', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Delete('api/logs')
    clearLogs() {
        try {
            if (fs.existsSync(this.logsPath)) fs.writeFileSync(this.logsPath, '');
            if (fs.existsSync(this.errorLogsPath)) fs.writeFileSync(this.errorLogsPath, '');
            return { message: 'Logs cleared successfully' };
        } catch (error) {
            throw new HttpException('Failed to clear logs', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get()
    @Header('Content-Type', 'text/html')
    getDashboard() {
        const html = `
<!DOCTYPE html>
<html lang="es" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Balcom - Pasarela Monitor</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        dark: '#0f172a',
                        darker: '#020617',
                        card: '#1e293b'
                    }
                }
            }
        }
    </script>
    <style>
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: #0f172a; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #475569; }
    </style>
</head>
<body class="bg-darker text-slate-300 font-sans min-h-screen flex flex-col items-center">
    
    <!-- Pantalla de Login -->
    <div id="login-screen" class="w-full flex-1 flex items-center justify-center p-4">
        <div class="bg-card p-8 rounded-xl border border-slate-700 shadow-2xl max-w-sm w-full text-center">
            <div class="w-16 h-16 bg-blue-500/10 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-blue-500/20">
                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
            </div>
            <h2 class="text-2xl font-bold text-white mb-2">Acceso Restringido</h2>
            <p class="text-slate-400 mb-6 text-sm">Panel de control de logs de Pasarela</p>
            
            <input type="text" id="username" value="admin" class="w-full bg-darker border border-slate-600 rounded-lg px-4 py-3 text-white mb-3 focus:outline-none focus:border-blue-500 transition-colors" placeholder="Usuario">
            <input type="password" id="password" class="w-full bg-darker border border-slate-600 rounded-lg px-4 py-3 text-white mb-4 focus:outline-none focus:border-blue-500 transition-colors" placeholder="Contraseña">
            
            <button onclick="attemptLogin()" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-lg transition-colors shadow-lg shadow-blue-500/20">
                Ingresar
            </button>
            <p id="login-error" class="text-red-400 text-sm mt-4 hidden bg-red-500/10 py-2 rounded border border-red-500/20">Credenciales incorrectas</p>
        </div>
    </div>

    <!-- Panel de Logs (Oculto al inicio) -->
    <div id="main-dashboard" class="w-full max-w-6xl p-6 flex-1 flex flex-col h-screen hidden">
        <div class="flex justify-between items-center bg-card p-5 rounded-t-xl border border-slate-700 shadow-xl">
            <div>
                <h1 class="text-2xl font-bold text-white flex items-center gap-3">
                    <svg class="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"></path></svg>
                    Balcom Pasarela Monitor
                </h1>
                <p class="text-sm text-slate-400 mt-1">Real-time payment system activity log</p>
            </div>
            
            <div class="flex gap-3">
                <button onclick="toggleAutoRefresh()" id="btnRefreshToggle" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors flex items-center gap-2 text-sm font-medium">
                    <span id="refreshIcon" class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Auto-Refresh: ON
                </button>
                <button onclick="clearLogs()" class="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 rounded-lg transition-colors text-sm font-medium">
                    Limpiar
                </button>
                <button onclick="logout()" class="px-4 py-2 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors text-sm font-medium">
                    Salir
                </button>
            </div>
        </div>

        <div class="bg-card border-x border-slate-700 p-3 flex gap-2">
            <button onclick="setFilter('all')" id="filter-all" class="filter-btn px-4 py-1.5 rounded-full text-sm font-medium bg-blue-500/20 text-blue-400 border border-blue-500/50 shadow-inner">Todos</button>
            <button onclick="setFilter('error')" id="filter-error" class="filter-btn px-4 py-1.5 rounded-full text-sm font-medium bg-slate-800 text-slate-400 border border-slate-700 hover:text-white transition-colors">Solo Errores</button>
        </div>

        <div class="bg-card border border-slate-700 rounded-b-xl overflow-hidden flex-1 flex flex-col relative shadow-xl">
            <div id="loader" class="absolute inset-0 bg-card/80 flex items-center justify-center z-10 hidden">
                <svg class="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            </div>
            <div class="overflow-y-auto flex-1 p-4" id="logs-list">
                <!-- Logs rendered here -->
            </div>
        </div>
    </div>

    <script>
        let autoRefreshInterval = null;
        let isAutoRefreshOn = true;
        let currentFilter = 'all';
        let authToken = localStorage.getItem('balcom_pasarela_auth_token') || null;

        document.getElementById('password').addEventListener('keypress', function(e) {
            if(e.key === 'Enter') attemptLogin();
        });

        function showLogin() {
            document.getElementById('login-screen').classList.remove('hidden');
            document.getElementById('main-dashboard').classList.add('hidden');
            if(autoRefreshInterval) clearInterval(autoRefreshInterval);
            document.getElementById('password').value = '';
        }

        function showDashboard() {
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('main-dashboard').classList.remove('hidden');
            fetchLogs(true);
            if(isAutoRefreshOn) autoRefreshInterval = setInterval(() => fetchLogs(false), 2000);
        }

        async function attemptLogin() {
            const user = document.getElementById('username').value.trim();
            const pass = document.getElementById('password').value.trim();
            if(!user || !pass) return;

            authToken = btoa(user + ':' + pass);
            
            const success = await fetchLogs(true);
            if (success) {
                localStorage.setItem('balcom_pasarela_auth_token', authToken);
                document.getElementById('login-error').classList.add('hidden');
                showDashboard();
            } else {
                document.getElementById('login-error').classList.remove('hidden');
                authToken = null;
            }
        }

        function logout() {
            localStorage.removeItem('balcom_pasarela_auth_token');
            authToken = null;
            showLogin();
        }

        function formatTime(isoString) {
            const d = new Date(isoString);
            return '<span class="text-slate-500">' + d.toLocaleTimeString('es-CO') + '</span>';
        }

        function getLevelBadge(level) {
            if (level === 'error') return '<span class="px-2 py-0.5 rounded text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30">ERROR</span>';
            if (level === 'warn') return '<span class="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">WARN</span>';
            return '<span class="px-2 py-0.5 rounded text-xs font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">INFO</span>';
        }

        function renderLogs(logs) {
            const container = document.getElementById('logs-list');
            const filtered = logs.filter(log => currentFilter === 'all' || log.level === currentFilter);
            
            if (filtered.length === 0) {
                container.innerHTML = '<div class="flex h-full items-center justify-center text-slate-500 italic">No hay logs registrados.</div>';
                return;
            }

            container.innerHTML = filtered.map(log => {
                const colorClass = log.level === 'error' ? 'border-l-red-500 bg-red-500/5' : 'border-l-blue-500 bg-slate-800/50';
                const contextBadge = log.context ? \`<span class="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded ml-2">[\${log.context}]</span>\` : '';
                return \`
                    <div class="mb-2 p-3 rounded border-y border-r border-l-4 \${colorClass} border-slate-700/50 shadow-sm font-mono text-sm break-words flex gap-4">
                        <div class="whitespace-nowrap flex-shrink-0">\${formatTime(log.timestamp)}</div>
                        <div class="flex-1">
                            <div class="flex items-center gap-2 mb-1">
                                \${getLevelBadge(log.level)} \${contextBadge}
                            </div>
                            <div class="\${log.level === 'error' ? 'text-red-300' : 'text-slate-300'}>\${log.message}</div>
                        </div>
                    </div>
                \`;
            }).join('');
        }

        async function fetchLogs(showLoader = false) {
            if (!authToken) return false;
            if(showLoader) document.getElementById('loader').classList.remove('hidden');
            
            try {
                const res = await fetch('/payment-logs/api/logs', {
                    headers: { 'Authorization': 'Basic ' + authToken }
                });
                if (res.status === 401) return false;
                
                const data = await res.json();
                renderLogs(data);
                return true;
            } catch (err) {
                console.error('Failed to load logs', err);
                return false;
            } finally {
                if(showLoader) document.getElementById('loader').classList.add('hidden');
            }
        }

        async function clearLogs() {
            if (!confirm('¿Estás seguro de que quieres borrar todos los logs?')) return;
            try {
                await fetch('/payment-logs/api/logs', { 
                    method: 'DELETE',
                    headers: { 'Authorization': 'Basic ' + authToken }
                });
                fetchLogs(true);
            } catch (err) {
                alert('Hubo un error al limpiar los logs.');
            }
        }

        function setFilter(filter) {
            currentFilter = filter;
            document.querySelectorAll('.filter-btn').forEach(b => {
                b.className = 'filter-btn px-4 py-1.5 rounded-full text-sm font-medium bg-slate-800 text-slate-400 border border-slate-700 hover:text-white transition-colors';
            });
            const active = document.getElementById('filter-' + filter);
            if (filter === 'error') {
                active.className = 'filter-btn px-4 py-1.5 rounded-full text-sm font-medium bg-red-500/20 text-red-400 border border-red-500/50 shadow-inner';
            } else {
                active.className = 'filter-btn px-4 py-1.5 rounded-full text-sm font-medium bg-blue-500/20 text-blue-400 border border-blue-500/50 shadow-inner';
            }
            fetchLogs(false);
        }

        function toggleAutoRefresh() {
            isAutoRefreshOn = !isAutoRefreshOn;
            const btn = document.getElementById('btnRefreshToggle');
            if (isAutoRefreshOn) {
                btn.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Auto-Refresh: ON';
                autoRefreshInterval = setInterval(() => fetchLogs(false), 2000);
            } else {
                btn.innerHTML = '<span class="w-2 h-2 rounded-full bg-slate-500"></span> Auto-Refresh: OFF';
                clearInterval(autoRefreshInterval);
            }
        }

        if (authToken) {
            fetchLogs(true).then(success => {
                if (success) showDashboard();
                else showLogin();
            });
        } else {
            showLogin();
        }
    </script>
</body>
</html>
        `;
        return html;
    }
}
