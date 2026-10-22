# Practice image: ubuntu plus the tools the Terminal tab teaches (ps, top, man pages, less, vim, tree ...).
#   docker build -t playground-linux -f docker/linux.Dockerfile .
# then set SANDBOX_IMAGE_LINUX=playground-linux
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
      procps psmisc less man-db manpages vim-tiny nano tree file bsdextrautils diffutils findutils \
      tar gzip bzip2 zip unzip gcc libc6-dev make ca-certificates \
    && yes | unminimize || true \
    && rm -rf /var/lib/apt/lists/*
