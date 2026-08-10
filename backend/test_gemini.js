const apiKey = process.env.GEMINI_API_KEY;

async function run() {
    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );

        const data = await res.json();

        const flashModels = data.models.filter(
            m =>
                m.name.includes("flash") &&
                m.supportedGenerationMethods.includes("generateContent")
        );

        console.log(flashModels.map(m => m.name));
    } catch (err) {
        console.error(err);
    }
}

run();