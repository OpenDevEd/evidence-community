group "acceptance" {
  targets = ["app", "search-indexer", "source-sync", "source-writeback", "publication-worker"]
}

target "acceptance-image" {
  context    = "."
  dockerfile = "Dockerfile"
}

target "app" {
  inherits = ["acceptance-image"]
  target   = "final"
  tags     = ["evidence-library-acceptance:local"]
}

target "search-indexer" {
  inherits = ["acceptance-image"]
  target   = "search-indexer"
  tags     = ["evidence-library-acceptance-search-indexer:local"]
}

target "source-sync" {
  inherits = ["acceptance-image"]
  target   = "source-sync"
  tags     = ["evidence-library-acceptance-source-sync:local"]
}

target "source-writeback" {
  inherits = ["acceptance-image"]
  target   = "source-writeback"
  tags     = ["evidence-library-acceptance-source-writeback:local"]
}

target "publication-worker" {
  inherits = ["acceptance-image"]
  target   = "publication-worker"
  tags     = ["evidence-library-acceptance-publication-worker:local"]
}
