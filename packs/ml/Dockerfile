# Machine learning and interpretability: PyTorch (with CUDA, used only when the owner allows the GPU),
# JAX on the CPU, Transformers, and the common interpretability and evaluation libraries.
ARG BASE=problemhive-tools-base:0.1.0
FROM ${BASE}
USER root
RUN pip install --no-cache-dir torch
RUN pip install --no-cache-dir \
      transformers datasets accelerate safetensors tokenizers \
      einops jaxtyping \
      transformer-lens sae-lens nnsight \
      inspect-ai \
      "jax[cpu]"
USER hive
# Runs have no network. Model weights and datasets are read from the data area, where the owner puts
# them; these settings stop the libraries from trying to download anything.
ENV HF_HOME=/data/hf HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_DATASETS_OFFLINE=1 \
    TORCH_HOME=/data/torch
