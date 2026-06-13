# Luzuno Control Panel

Panel web multitenant para administrar Anubs de ElevenLabs con autenticacion por Keycloak.

## Servicios

- `agents-panel`: aplicacion Node/Express.
- `keycloak`: autenticacion, usuarios y rol `Administrador`.
- `mysql`: persistencia para Keycloak y el panel.

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

## URLs por defecto

- Panel: `http://192.168.0.115:3000`
- Keycloak: `http://192.168.0.115:8080`
- MySQL: `192.168.0.115:3306`

## Nota de seguridad

No subir `.env` ni secretos reales al repositorio. Para produccion, publicar Keycloak y el panel detras de HTTPS.
