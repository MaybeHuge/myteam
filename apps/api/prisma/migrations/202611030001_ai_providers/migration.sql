CREATE TABLE "AiProviderConfig" (
  "provider" VARCHAR(32) NOT NULL,
  "baseUrl" VARCHAR(500) NOT NULL,
  "model" VARCHAR(200) NOT NULL,
  "secret" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("provider")
);
