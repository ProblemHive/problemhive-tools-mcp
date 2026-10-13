# Neuroscience: simulation of neurons and networks, electrophysiology and imaging analysis.
ARG BASE=problemhive-tools-base:0.1.0
FROM ${BASE}
USER root
RUN pip install --no-cache-dir brian2 mne nilearn nibabel neo elephant neuron
USER hive
ENV MNE_DONTWRITE_HOME=true NILEARN_DATA=/tmp/nilearn
