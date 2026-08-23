group "acceptance" {
  targets = ["app", "search-indexer", "publication-worker"]
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

target "publication-worker" {
  inherits = ["acceptance-image"]
  target   = "publication-worker"
  tags     = ["evidence-library-acceptance-publication-worker:local"]
}
