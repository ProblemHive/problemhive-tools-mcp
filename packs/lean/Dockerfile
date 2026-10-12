# Lean 4 with Mathlib, with the prebuilt Mathlib files baked in so no network is needed at run time.
ARG BASE=problemhive-sandbox-base:0.1.0
FROM ${BASE}
USER hive
WORKDIR /home/hive
ENV PATH="/home/hive/.elan/bin:${PATH}"
RUN curl -sSf https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh | sh -s -- -y --default-toolchain none \
    && (lake +leanprover-community/mathlib4:lean-toolchain new hivelean math || test -f hivelean/lakefile.toml)
# Creating the project already tries to fetch the Mathlib cache. It is about 9,000 files and a few
# fail now and then, so that attempt may fail; try again here before giving up.
RUN cd hivelean && (lake exe cache get || lake exe cache get || lake exe cache get || lake exe cache get) && lake build
# Runs have a read-only system, so nothing may be worked out or written at run time: fix the default
# toolchain and write down where Mathlib's compiled files are.
RUN cd hivelean && elan default "$(cat lean-toolchain)" \
    && lake env printenv LEAN_PATH > /home/hive/lean-path \
    && cat lean-toolchain > /home/hive/lean-version \
    && echo 'import Mathlib' > /tmp/t.lean && LEAN_PATH="$(cat /home/hive/lean-path)" lean /tmp/t.lean
USER root
COPY lean-check lean-tree /usr/local/bin/
RUN sed -i 's/\r$//' /usr/local/bin/lean-check /usr/local/bin/lean-tree && chmod +x /usr/local/bin/lean-check /usr/local/bin/lean-tree
USER hive
WORKDIR /work
