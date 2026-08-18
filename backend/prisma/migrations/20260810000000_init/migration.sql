-- CreateTable
CREATE TABLE "TelemetrySample" (
    "id" SERIAL NOT NULL,
    "channel" TEXT NOT NULL,
    "simTime" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,

    CONSTRAINT "TelemetrySample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingDecision" (
    "id" SERIAL NOT NULL,
    "simTime" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "route" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "estLatencyMs" DOUBLE PRECISION NOT NULL,
    "estPacketLoss" DOUBLE PRECISION NOT NULL,
    "queueDepth" INTEGER NOT NULL,
    "reasoning" TEXT NOT NULL,
    "candidates" JSONB NOT NULL,

    CONSTRAINT "RoutingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandLog" (
    "id" SERIAL NOT NULL,
    "commandId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "simTime" TIMESTAMP(3) NOT NULL,
    "ackAt" TIMESTAMP(3),
    "uplinkDelay" INTEGER NOT NULL,
    "result" TEXT,

    CONSTRAINT "CommandLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" SERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "simTime" TIMESTAMP(3) NOT NULL,
    "severity" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelemetrySample_channel_simTime_idx" ON "TelemetrySample"("channel", "simTime");

-- CreateIndex
CREATE INDEX "TelemetrySample_simTime_idx" ON "TelemetrySample"("simTime");

-- CreateIndex
CREATE INDEX "RoutingDecision_simTime_idx" ON "RoutingDecision"("simTime");

-- CreateIndex
CREATE UNIQUE INDEX "CommandLog_commandId_key" ON "CommandLog"("commandId");

-- CreateIndex
CREATE INDEX "CommandLog_issuedAt_idx" ON "CommandLog"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventLog_eventId_key" ON "EventLog"("eventId");

-- CreateIndex
CREATE INDEX "EventLog_simTime_idx" ON "EventLog"("simTime");

-- CreateIndex
CREATE INDEX "EventLog_source_simTime_idx" ON "EventLog"("source", "simTime");

