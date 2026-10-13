# Isabelle/HOL, with the HOL image prebuilt so that checking a theory starts in seconds.
ARG BASE=problemhive-sandbox-base:0.1.0
FROM ${BASE}
USER root
# The release, from the University of Cambridge's copy of the Isabelle distribution. Cambridge is one
# of Isabelle's two home sites, and unlike the Munich one it serves the file over https all the way.
RUN curl -fsSL --retry 3 https://www.cl.cam.ac.uk/research/hvg/Isabelle/dist/Isabelle2025-2_linux.tar.gz | tar xz -C /opt \
    && ln -s /opt/Isabelle2025-2/bin/isabelle /usr/local/bin/isabelle
# Build the HOL image into the installation itself: runs have a read-only system and could not build it.
RUN isabelle build -o system_heaps -b HOL && rm -rf /root/.isabelle
COPY isabelle-check /usr/local/bin/isabelle-check
RUN sed -i 's/\r$//' /usr/local/bin/isabelle-check && chmod +x /usr/local/bin/isabelle-check
USER hive
# Isabelle keeps its working files under the user's home; point that at the temporary area.
ENV USER_HOME=/tmp
