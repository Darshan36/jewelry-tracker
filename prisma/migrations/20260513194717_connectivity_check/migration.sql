-- CreateTable
CREATE TABLE "_connectivity_check" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "_connectivity_check_pkey" PRIMARY KEY ("id")
);
