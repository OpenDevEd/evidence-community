# The shared Elasticsearch for every Evidence Library on a host (OpenDevEd/new-el#718), with the ICU plugin so
# Chinese, Japanese, Thai, and other text without spaces between words is split into words.
FROM docker.elastic.co/elasticsearch/elasticsearch:9.5.5
RUN bin/elasticsearch-plugin install --batch analysis-icu
