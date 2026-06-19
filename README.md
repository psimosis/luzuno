# Luzuno Control Panel

Panel web multitenant para administrar Anubs de ElevenLabs con autenticacion por Keycloak.

## Servicios

- `agents-panel`: aplicacion Node/Express.
- `keycloak`: autenticacion, usuarios y rol `Administrador`.
- `mysql`: persistencia para Keycloak y el panel.

El login de Keycloak usa el theme `keycloak-theme/luzuno`, montado en `/opt/keycloak/themes`.

## Funcionalidad

- Login con Keycloak.
- Dashboard de Anubs disponibles por usuario.
- Configuracion de `Instrucciones del Anub`.
- Administracion de usuarios, roles, passwords y API keys de ElevenLabs.
- API keys guardadas cifradas en MySQL.

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

## Nota de seguridad

No subir `.env` ni secretos reales al repositorio. Para produccion, publicar Keycloak y el panel detras de HTTPS.
