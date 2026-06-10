export function getCamunda7Config() {
  return {
    baseUrl: process.env.CAMUNDA7_BASE_URL || "http://localhost:8080/engine-rest",
    engineName: process.env.CAMUNDA7_ENGINE_NAME || "",
    username: process.env.CAMUNDA7_USERNAME || "",
    password: process.env.CAMUNDA7_PASSWORD || "",
    deploymentSource: process.env.CAMUNDA7_DEPLOYMENT_SOURCE || "process-platform"
  };
}
