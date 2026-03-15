# Guía de Despliegue en VPS (Backend Wompi + WispHub)

Esta guía describe los pasos necesarios para desplegar el backend de la pasarela de pagos en tu VPS (Servidor Privado Virtual), cambiando el puerto por defecto (3000) por otro puerto para evitar conflictos, y manteniéndolo en ejecución permanentemente.

## 1. Cambiar el Puerto de la Aplicación

Dado que es posible que ya tengas otras aplicaciones corriendo en el puerto `3000` de tu VPS (por ejemplo, React u otra API), cambiaremos el puerto al **`3001`** (o el que prefieras).

En el archivo `.env` del servidor VPS, asegúrate de actualizar la variable `PORT`.

1. Abre tu `.env` de producción en el VPS.
2. Modifica o agrega la línea del puerto:
   ```env
   PORT=3001
   ```

*(NestJS internamente leerá la variable `PORT` del `.env` y levantará el servidor en ese puerto en lugar del 3000).*

## 2. Preparar el Proyecto en el VPS

Abre la terminal de tu VPS (usualmente por SSH) y sigue estos pasos en la carpeta donde subiste el código:

1. **Instalar dependencias de producción:**
   ```bash
   npm install --omit=dev
   ```

2. **Compilar el proyecto:**
   Generará la carpeta `dist/` requerida para producción.
   ```bash
   npm run build
   ```

## 3. Mantener el Backend en Ejecución usando PM2

Para evitar que el backend se apague al cerrar la terminal del VPS, es altamente recomendable usar **PM2** (un gestor de procesos de Node.js).

1. **Instalar PM2 globalmente** (si no lo tienes):
   ```bash
   npm install -g pm2
   ```

2. **Arrancar el servidor de NestJS con PM2:**
   Usa el archivo compilado `main.js` dentro de la carpeta `dist`. Asígnale un nombre descriptivo, por ejemplo "pasarela-wompi".
   ```bash
   pm2 start dist/main.js --name "pasarela-wompi"
   ```

3. **Configurar PM2 para que inicie automáticamente al reiniciar el VPS:**
   ```bash
   pm2 startup
   pm2 save
   ```

A partir de este momento, puedes ver los logs (por si Wompi da algún error 422 o WispHub falla) corriendo:
```bash
pm2 logs pasarela-wompi
```

## 4. Configurar un Proxy Reverso (Opcional pero Recomendado: Nginx o Apache)

Para que Wompi pueda enviarle el Webhook a tu aplicación, el backend necesita estar expuesto bajo tu dominio `HTTPS`. No es buena práctica que Wompi intente conectarse directamente a `http://tu_ip_o_dominio:3001`. 

Lo ideal es usar Nginx o Apache para recibir el tráfico en el puerto `443 (HTTPS)` y desviarlo al `3001`.

### Ejemplo con Nginx

1. Edita tu configuración de dominio (`/etc/nginx/sites-available/api.pagos.balcom.cloud`).
2. Agrega una ruta (`location`) que intercepte `/` y lo envíe al puerto local `3001`:

```nginx
server {
    server_name api.pagos.balcom.cloud; # Tu dominio real
    
    # ... otras configuraciones HTTPS ...

    location / {
        proxy_pass http://127.0.0.1:3001; # Apuntar al nuevo puerto del .env
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

3. **Reinicia Nginx:**
   ```bash
   sudo systemctl restart nginx
   ```

## 5. El Ajuste Final en Wompi

¡Eso es todo por el lado del servidor! Tu backend ahora estará disponible "hacia el exterior" desde Nginx.

Finalmente, debes dirigirte al panel de Control de **Wompi Producción > Desarrolladores > Seguimiento de Transacciones (URL de Eventos)**, y ahora sí, con tu backend en internet, pegar la URL oficial que conectará ambos ecosistemas:

👉 `https://api.pagos.balcom.cloud/payments/webhook`

*(Ya con esto Wompi enviará las confirmaciones de pago directamente a tu dominio `api.pagos.balcom.cloud`).*
