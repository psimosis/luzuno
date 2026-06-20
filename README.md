# Luzuno Control Panel

Panel web multitenant para administrar Anubs de ElevenLabs con autenticacion por Keycloak.

## Servicios

- `agents-panel`: aplicacion Node/Express.
- `keycloak`: autenticacion, usuarios y rol `Administrador`.
- `mysql`: persistencia para Keycloak y el panel.
- `meet-browser-sofia`: Chromium con noVNC para la cuenta Google de Sofia.
- `meet-bridge-sofia`: controlador experimental para que un Anub ingrese a Google Meet.

El login de Keycloak usa el theme `keycloak-theme/luzuno`, montado en `/opt/keycloak/themes`.

## Funcionalidad

- Login con Keycloak.
- Dashboard de Anubs disponibles por usuario.
- Configuracion de `Instrucciones del Anub`.
- Administracion de usuarios, roles, passwords y API keys de ElevenLabs.
- API keys guardadas cifradas en MySQL.
- Bridge experimental de Google Meet con consola noVNC para login inicial del usuario Google del Anub.

## Configuracion

Copiar el archivo de ejemplo:

```bash
cp .env.example .env
```

Completar todos los valores `change-me` con secretos reales.

## Deploy

```bash
docker compose up -d --build
```

Ver estado:

```bash
docker compose ps
docker compose logs -f agents-panel
```

## URLs con DHCP

El panel y Keycloak toman el host desde la URL con la que se accede. Si el servidor recibe una IP por DHCP, usar esa IP:

- Panel HTTPS: `https://<ip-dhcp>:3443`
- Panel HTTP: `http://<ip-dhcp>:3000`
- Keycloak: `http://<ip-dhcp>:8080`
- MySQL: `<ip-dhcp>:3306`
- Meet Bridge Sofia: `http://<ip-dhcp>:3200`
- noVNC Sofia: `http://<ip-dhcp>:7900`

## Meet Bridge experimental

El bridge controla un Chromium remoto mediante Chrome DevTools. El perfil se guarda en el volumen `meet_browser_sofia_data`, por lo que el login Google del agente sobrevive reinicios.

Primer uso:

1. Abrir `http://<ip-dhcp>:3200`.
2. Abrir la consola noVNC desde el boton o ir a `http://<ip-dhcp>:7900`.
3. Usar `Abrir login Google` y completar el acceso con la cuenta Enterprise del Anub.
4. Pegar una URL de Meet y usar `Entrar a Meet`.

Esta rama deja lista la base para que Sofia participe como usuario real de Meet. La integracion completa de cara/voz dinamica Anam/ElevenLabs requiere una segunda capa de ruteo multimedia hacia camara y microfono virtual.

## Nota de seguridad

No subir `.env` ni secretos reales al repositorio. Para produccion, publicar Keycloak y el panel detras de HTTPS.
