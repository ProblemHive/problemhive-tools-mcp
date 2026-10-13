# The base pack: solvers, computer algebra and the usual scientific Python packages.
# Every other pack is built on top of this image.
FROM python:3.12-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git build-essential gfortran cmake \
      cadical minisat z3 \
      pari-gp gap-core nauty singular \
      poppler-utils tesseract-ocr graphviz \
      unzip zip zstd p7zip-full xz-utils bzip2 \
      file less tree xxd ripgrep jq gawk bc sqlite3 parallel \
    && rm -rf /var/lib/apt/lists/*

# Kissat is not packaged for this Debian release: build it from its author's repository.
RUN git clone --depth 1 https://github.com/arminbiere/kissat.git /tmp/kissat \
    && cd /tmp/kissat && ./configure && make -j8 \
    && cp build/kissat /usr/local/bin/kissat && rm -rf /tmp/kissat
# drat-trim checks the proof certificates SAT solvers write for "unsatisfiable".
RUN git clone --depth 1 https://github.com/marijnheule/drat-trim.git /tmp/drat-trim \
    && cd /tmp/drat-trim && gcc -O2 -o /usr/local/bin/drat-trim drat-trim.c && rm -rf /tmp/drat-trim

RUN pip install --no-cache-dir \
      python-sat z3-solver ortools highspy pyscipopt \
      sympy mpmath python-flint \
      networkx pynauty python-igraph \
      numpy scipy pandas statsmodels scikit-learn matplotlib seaborn pingouin \
      numba cython gmpy2 cvxpy pulp \
      rdkit biopython astropy \
      pyreadstat pyreadr pypdf pdfplumber \
      openpyxl xlrd odfpy python-docx lxml beautifulsoup4 xmltodict chardet \
      h5py pyarrow netCDF4 xarray zstandard duckdb polars \
      tqdm tabulate jsonschema pytest hypothesis

# Debian installs nauty's programs as nauty-geng and so on; add the usual short names (geng, genbg, labelg ...).
RUN for f in /usr/bin/nauty-*; do ln -s "$f" "/usr/local/bin/$(basename "$f" | sed 's/^nauty-//')"; done

# Runs happen as this user, with a read-only system: only /work (the workspace) and /tmp can be written.
RUN useradd --create-home --shell /bin/bash --uid 1000 hive \
    && mkdir -p /work /data && chown hive:hive /work /data
COPY phs-fetch /usr/local/bin/phs-fetch
RUN sed -i 's/\r$//' /usr/local/bin/phs-fetch && chmod +x /usr/local/bin/phs-fetch

USER hive
ENV MPLBACKEND=Agg MPLCONFIGDIR=/tmp/mpl XDG_CACHE_HOME=/tmp/cache PYTHONDONTWRITEBYTECODE=1 \
    NUMBA_CACHE_DIR=/tmp/numba PARALLEL_HOME=/tmp/parallel
WORKDIR /work
