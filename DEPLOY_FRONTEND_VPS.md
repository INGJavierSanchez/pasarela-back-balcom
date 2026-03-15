# Guía de Despliegue en VPS (Frontend)

Esta guía describe los pasos para subir la aplicación Frontend (la interfaz visual de pagos) a tu servidor VPS y conectarla correctamente con tu dominio principal y el backend que acabamos de configurar.

Dado que la mayoría de los frontends modernos pueden ser aplicaciones estáticas (React puramente cliente, Angular, Vue, Vite) o aplicaciones del lado del servidor (Next.js), aquí tienes ambas alternativas.

*(Se asume que tu dominio principal para los clientes será `https://pagos.balcom.cloud`)*.

---

## 1. Preparar el Entorno en el VPS

Accede a la terminal de tu VPS y ubícate en la carpeta donde subiste el código fuente del Frontend:

1. **Instala las dependencias:**
   ```bash
   npm install
   ```

2. **Configura las variables de entorno (.env):**
   Asegúrate de que en el `.env` del frontend, la URL que apunta al backend esté configurada hacia tu dominio de producción recién creado:
   ```env
   VITE_API_URL=https://api.pagos.balcom.cloud
   # (O el nombre de variable que use tu framework, ej: NEXT_PUBLIC_API_URL)
   ```

3. **Compilar el proyecto:**
   Esto generará la carpeta con los archivos optimizados (`dist/`, `build/` o `.next/` dependiendo del framework).
   ```bash
   npm run build
   ```

---

## OPCIÓN A: Si el Frontend es ESTÁTICO (React, Vite, Vue, Angular)

Si al correr `npm run build` se generó una carpeta llamada `dist/` o `build/` que contiene solo archivos HTML, CSS y JS, la mejor forma (y la más rápida) de alojarlo es usar directamente Nginx para que sirva esos archivos. ¡No necesitas PM2 para esto!

### 1. Configurar Nginx para el Frontend
Edita o crea el archivo de configuración de Nginx para el dominio del frontend:
```bash
sudo nano /etc/nginx/sites-available/pagos.balcom.cloud
```

### 2. Pegar la configuración de servidor estático
Agrega este bloque, asegurándote de cambiar `/ruta/absoluta/a/tu/frontend/dist` por la ruta real en tu VPS:

```nginx
server {
    server_name pagos.balcom.cloud; # El dominio público para tus clientes

    # La ruta exacta a la carpeta dist/ o build/
    root /var/www/pagos-front-balcom/dist; 
    index index.html;

    # Todas las rutas en frameworks como React/Vite deben redirigir al index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # ... configuraciones HTTPS (Certbot/SSL) ...
}
```

### 3. Reiniciar Nginx
```bash
sudo systemctl reload nginx
```
¡Listo! El frontend ya estará vivo en `https://pagos.balcom.cloud`.

---

## OPCIÓN B: Si el Frontend es SSR / Node (Next.js, Nuxt)

Si tu framework ejecuta código de servidor propio (ej. Next.js, donde usas `npm start` para arrancar), debes mantenerlo vivo con **PM2** y hacer un Proxy Reverso con Nginx (igual que con el backend).

### 1. Arrancar el Frontend con PM2
Asegúrate de configurar el puerto en el que va a correr localmente (ej. `3000`, ya que el backend lo movimos al `3001`):

```bash
# Para un proyecto Next.js estándar:
pm2 start npm --name "frontend-pagos" -- start --port 3000
```
Guarda los cambios de PM2:
```bash
pm2 save
```

### 2. Configurar Nginx para el Proxy Reverso
Edita el archivo de tu dominio:
```bash
sudo nano /etc/nginx/sites-available/pagos.balcom.cloud
```

Y configúralo para desviar el tráfico al puerto 3000 local:
```nginx
server {
    server_name pagos.balcom.cloud;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # ... configuraciones HTTPS (Certbot/SSL) ...
}
```

### 3. Reiniciar Nginx
```bash
sudo systemctl reload nginx
```
¡Listo! El frontend SSR ya estará activo en `https://pagos.balcom.cloud`.
