export async function generateProfileImage(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY no esta configurada.");

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      prompt,
      size: process.env.OPENAI_IMAGE_SIZE || "1024x1024",
      n: 1
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI image generation failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const image = data.data?.[0];
  const b64 = image?.b64_json || image?.image_base64;
  if (b64) return Buffer.from(b64, "base64");

  if (image?.url) {
    const imageResponse = await fetch(image.url);
    if (!imageResponse.ok) throw new Error(`No se pudo descargar la imagen generada: ${imageResponse.status}`);
    return Buffer.from(await imageResponse.arrayBuffer());
  }

  throw new Error("OpenAI no devolvio una imagen utilizable.");
}
