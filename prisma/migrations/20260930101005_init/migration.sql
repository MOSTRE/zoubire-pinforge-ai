-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gumroadId" TEXT,
    "permalink" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT DEFAULT '',
    "thumbnailUrl" TEXT,
    "priceCents" INTEGER,
    "currency" TEXT DEFAULT 'usd',
    "tags" TEXT DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'catalog',
    "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProductSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "detail" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ProductKeyword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'secondary',
    CONSTRAINT "ProductKeyword_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "targetAudience" TEXT NOT NULL DEFAULT '',
    "buyerIntent" TEXT NOT NULL DEFAULT '',
    "problemSolved" TEXT NOT NULL DEFAULT '',
    "benefit" TEXT NOT NULL DEFAULT '',
    "useCases" TEXT NOT NULL DEFAULT '[]',
    "searchIntent" TEXT NOT NULL DEFAULT '',
    "contentAngles" TEXT NOT NULL DEFAULT '[]',
    "primaryKeywords" TEXT NOT NULL DEFAULT '[]',
    "secondaryKeywords" TEXT NOT NULL DEFAULT '[]',
    "longTailKeywords" TEXT NOT NULL DEFAULT '[]',
    "relatedTopics" TEXT NOT NULL DEFAULT '[]',
    "suggestedBoards" TEXT NOT NULL DEFAULT '[]',
    "pinConcepts" TEXT NOT NULL DEFAULT '[]',
    "rawJson" TEXT NOT NULL DEFAULT '{}',
    "provider" TEXT NOT NULL DEFAULT 'ollama',
    "model" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductAnalysis_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "primaryKeyword" TEXT NOT NULL DEFAULT '',
    "secondaryKeywords" TEXT NOT NULL DEFAULT '[]',
    "hashtags" TEXT NOT NULL DEFAULT '[]',
    "cta" TEXT NOT NULL DEFAULT '',
    "destinationUrl" TEXT NOT NULL,
    "boardId" TEXT,
    "boardName" TEXT,
    "imagePath" TEXT,
    "imageHash" TEXT,
    "contentFingerprint" TEXT,
    "creativeAngle" TEXT NOT NULL DEFAULT 'product-focused',
    "template" TEXT NOT NULL DEFAULT 'headline-hero',
    "imagePrompt" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" DATETIME,
    "publishedAt" DATETIME,
    "pinterestPinId" TEXT,
    "publishError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Pin_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PinAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pinId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "hash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PinAsset_pinId_fkey" FOREIGN KEY ("pinId") REFERENCES "Pin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PinterestBoard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pinterestId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT DEFAULT '',
    "privacy" TEXT DEFAULT 'PUBLIC',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PublishJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pinId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" DATETIME,
    "runAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublishJob_pinId_fkey" FOREIGN KEY ("pinId") REFERENCES "Pin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AiGeneration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "productId" TEXT,
    "pinId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'ollama',
    "model" TEXT NOT NULL DEFAULT '',
    "input" TEXT NOT NULL DEFAULT '{}',
    "output" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ImageGeneration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pinId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'local-synthetic',
    "prompt" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "inputPath" TEXT,
    "outputPath" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" TEXT DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_url_key" ON "Product"("url");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE INDEX "Product_permalink_idx" ON "Product"("permalink");

-- CreateIndex
CREATE INDEX "ProductKeyword_productId_idx" ON "ProductKeyword"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAnalysis_productId_key" ON "ProductAnalysis"("productId");

-- CreateIndex
CREATE INDEX "Pin_productId_idx" ON "Pin"("productId");

-- CreateIndex
CREATE INDEX "Pin_status_idx" ON "Pin"("status");

-- CreateIndex
CREATE INDEX "Pin_scheduledAt_idx" ON "Pin"("scheduledAt");

-- CreateIndex
CREATE INDEX "Pin_imageHash_idx" ON "Pin"("imageHash");

-- CreateIndex
CREATE INDEX "Pin_contentFingerprint_idx" ON "Pin"("contentFingerprint");

-- CreateIndex
CREATE INDEX "PinAsset_pinId_idx" ON "PinAsset"("pinId");

-- CreateIndex
CREATE UNIQUE INDEX "PinterestBoard_pinterestId_key" ON "PinterestBoard"("pinterestId");

-- CreateIndex
CREATE INDEX "PublishJob_status_idx" ON "PublishJob"("status");

-- CreateIndex
CREATE INDEX "PublishJob_scheduledAt_idx" ON "PublishJob"("scheduledAt");

-- CreateIndex
CREATE INDEX "AiGeneration_kind_idx" ON "AiGeneration"("kind");

-- CreateIndex
CREATE INDEX "ImageGeneration_status_idx" ON "ImageGeneration"("status");

-- CreateIndex
CREATE INDEX "ActivityEvent_type_idx" ON "ActivityEvent"("type");

-- CreateIndex
CREATE INDEX "ActivityEvent_createdAt_idx" ON "ActivityEvent"("createdAt");
