# Earth, climate and ecology: gridded data, meteorology, seismology, geodata, community ecology.
ARG BASE=problemhive-tools-base:0.1.0
FROM ${BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      cdo nco gdal-bin r-base-core r-cran-vegan r-cran-ape r-cran-phangorn \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir xarray netCDF4 h5netcdf cftime metpy obspy rasterio pyproj shapely geopandas cartopy
USER hive
